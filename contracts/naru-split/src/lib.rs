#![no_std]

use soroban_sdk::{
    Address, BytesN, Env, Vec, contract, contracterror, contractevent, contractimpl, contracttype,
    token::TokenClient,
};

/// Official Testnet USDC SAC. Seven decimals; never supplied by a caller.
pub const USDC: &str = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
/// Organizer plus at most twelve other participants.
pub const MAX_PARTICIPANTS: u32 = 13;
const TTL_THRESHOLD: u32 = 30 * 17_280;
const TTL_TARGET: u32 = 120 * 17_280;

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    InvalidCount = 1,
    DuplicateParticipant = 2,
    MissingOrganizer = 3,
    InvalidAmount = 4,
    ConflictingSplit = 5,
    NotFound = 6,
    NotParticipant = 7,
    OrganizerShare = 8,
    AlreadyPaid = 9,
    Cancelled = 10,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ShareState {
    /// Included in the expense, but never a request or a token transfer.
    Organizer,
    Outstanding,
    /// Ledger of the successful payment or cancellation. Terminal states.
    Paid(u32),
    Cancelled(u32),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Share {
    pub participant: Address,
    pub amount: i128,
    pub state: ShareState,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Split {
    pub recipient: Address,
    pub total: i128,
    pub shares: Vec<Share>,
    pub created_ledger: u32,
}

// Terms, terminal states, and the creation idempotency guard are ONE durable
// entry. Never remove it: archival restores the same record, not a fresh split.
#[contracttype]
#[derive(Clone)]
enum DataKey {
    Split(Address, BytesN<32>),
}

#[contractevent]
pub struct SplitCreated {
    #[topic]
    pub organizer: Address,
    #[topic]
    pub split_id: BytesN<32>,
    pub split: Split,
}

#[contractevent]
pub struct SharePaid {
    #[topic]
    pub organizer: Address,
    #[topic]
    pub split_id: BytesN<32>,
    #[topic]
    pub participant: Address,
    pub amount: i128,
    pub ledger: u32,
}

#[contractevent]
pub struct ShareCancelled {
    #[topic]
    pub organizer: Address,
    #[topic]
    pub split_id: BytesN<32>,
    #[topic]
    pub participant: Address,
    pub amount: i128,
    pub ledger: u32,
}

#[contract]
pub struct NaruSplit;

fn token(env: &Env) -> Address {
    Address::from_str(env, USDC)
}

fn extend(env: &Env, key: Option<&DataKey>) {
    let target = TTL_TARGET.min(env.storage().max_ttl());
    let threshold = TTL_THRESHOLD.min(target);
    // Extends both the instance and its WASM code TTL.
    env.storage().instance().extend_ttl(threshold, target);
    if let Some(key) = key {
        env.storage()
            .persistent()
            .extend_ttl(key, threshold, target);
    }
}

fn load(env: &Env, key: &DataKey) -> Result<Split, Error> {
    env.storage().persistent().get(key).ok_or(Error::NotFound)
}

fn save(env: &Env, key: &DataKey, split: &Split) {
    env.storage().persistent().set(key, split);
    extend(env, Some(key));
}

fn outstanding(split: &Split, participant: &Address) -> Result<(u32, Share), Error> {
    for (index, share) in split.shares.iter().enumerate() {
        if share.participant == *participant {
            return match share.state {
                ShareState::Outstanding => Ok((index as u32, share)),
                ShareState::Organizer => Err(Error::OrganizerShare),
                ShareState::Paid(_) => Err(Error::AlreadyPaid),
                ShareState::Cancelled(_) => Err(Error::Cancelled),
            };
        }
    }
    Err(Error::NotParticipant)
}

#[contractimpl]
impl NaruSplit {
    /// Create an equal reimbursement split. Creation is only the organizer's
    /// request; participants do not authorize anything until they call pay.
    /// The recipient is always the organizer. Participants MUST include them.
    /// Returns true on creation, false for an identical existing request.
    pub fn create(
        env: Env,
        organizer: Address,
        split_id: BytesN<32>,
        total: i128,
        participants: Vec<Address>,
    ) -> Result<bool, Error> {
        organizer.require_auth();
        let count = participants.len();
        if !(2..=MAX_PARTICIPANTS).contains(&count) {
            return Err(Error::InvalidCount);
        }
        if total < i128::from(count) {
            return Err(Error::InvalidAmount);
        }

        // Address's native Soroban ordering, not display strings or caller order.
        // Bounded insertion sort keeps rounding canonical across creation retries.
        let mut ordered = Vec::<Address>::new(&env);
        for participant in participants {
            let mut index = 0;
            while index < ordered.len() && ordered.get_unchecked(index) < participant {
                index += 1;
            }
            if index < ordered.len() && ordered.get_unchecked(index) == participant {
                return Err(Error::DuplicateParticipant);
            }
            ordered.insert(index, participant);
        }
        if !ordered.contains(&organizer) {
            return Err(Error::MissingOrganizer);
        }

        let base = total / i128::from(count);
        let remainder = total % i128::from(count);
        let mut shares = Vec::new(&env);
        for (index, participant) in ordered.iter().enumerate() {
            shares.push_back(Share {
                amount: base + i128::from((index as i128) < remainder),
                state: if participant == organizer {
                    ShareState::Organizer
                } else {
                    ShareState::Outstanding
                },
                participant,
            });
        }

        let key = DataKey::Split(organizer.clone(), split_id.clone());
        if let Some(existing) = env.storage().persistent().get::<_, Split>(&key) {
            if existing.total != total
                || existing.recipient != organizer
                || existing.shares.len() != shares.len()
                || existing
                    .shares
                    .iter()
                    .zip(shares.iter())
                    .any(|(a, b)| a.participant != b.participant || a.amount != b.amount)
            {
                return Err(Error::ConflictingSplit);
            }
            extend(&env, Some(&key));
            return Ok(false);
        }

        let split = Split {
            recipient: organizer.clone(),
            total,
            shares,
            created_ledger: env.ledger().sequence(),
        };
        save(&env, &key, &split);
        SplitCreated {
            organizer,
            split_id,
            split,
        }
        .publish(&env);
        Ok(true)
    }

    /// Authorize and settle only this participant's exact outstanding share.
    /// Auth includes this call AND the nested USDC.transfer(participant,
    /// organizer, amount). Neither creation nor another participant grants it.
    pub fn pay(
        env: Env,
        organizer: Address,
        split_id: BytesN<32>,
        participant: Address,
    ) -> Result<(), Error> {
        participant.require_auth();
        let key = DataKey::Split(organizer.clone(), split_id.clone());
        let mut split = load(&env, &key)?;
        let (index, mut share) = outstanding(&split, &participant)?;
        let ledger = env.ledger().sequence();
        share.state = ShareState::Paid(ledger);
        split.shares.set(index, share.clone());
        save(&env, &key, &split);
        // A failing transfer aborts this invocation, rolling back the settlement,
        // TTL updates, token changes, and events together. No caught token errors.
        TokenClient::new(&env, &token(&env)).transfer(
            &participant,
            &split.recipient,
            &share.amount,
        );
        SharePaid {
            organizer,
            split_id,
            participant,
            amount: share.amount,
            ledger,
        }
        .publish(&env);
        Ok(())
    }

    /// Cancel one unpaid request. Paid and cancelled requests are terminal.
    pub fn cancel(
        env: Env,
        organizer: Address,
        split_id: BytesN<32>,
        participant: Address,
    ) -> Result<(), Error> {
        organizer.require_auth();
        let key = DataKey::Split(organizer.clone(), split_id.clone());
        let mut split = load(&env, &key)?;
        let (index, mut share) = outstanding(&split, &participant)?;
        let ledger = env.ledger().sequence();
        share.state = ShareState::Cancelled(ledger);
        split.shares.set(index, share.clone());
        save(&env, &key, &split);
        ShareCancelled {
            organizer,
            split_id,
            participant,
            amount: share.amount,
            ledger,
        }
        .publish(&env);
        Ok(())
    }

    /// Bounded public state; successful reads also extend TTL when submitted.
    pub fn get(env: Env, organizer: Address, split_id: BytesN<32>) -> Option<Split> {
        let key = DataKey::Split(organizer, split_id);
        let split = env.storage().persistent().get(&key);
        extend(&env, split.as_ref().map(|_: &Split| &key));
        split
    }

    pub fn usdc(env: Env) -> Address {
        token(&env)
    }

    /// Permissionless maintenance. Also works for fully settled/cancelled splits.
    pub fn keep_alive(env: Env, organizer: Address, split_id: BytesN<32>) -> Result<(), Error> {
        let key = DataKey::Split(organizer, split_id);
        load(&env, &key)?;
        extend(&env, Some(&key));
        Ok(())
    }
}

#[cfg(test)]
mod test;
