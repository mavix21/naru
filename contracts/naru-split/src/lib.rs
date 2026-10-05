#![no_std]

use soroban_sdk::{
    Address, BytesN, Env, Vec, contract, contracterror, contractevent, contractimpl, contracttype,
    token::TokenClient,
};

/// Official Testnet USDC SAC. Seven decimals; never supplied by a caller.
pub const USDC: &str = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
/// Organizer plus at most twelve other participants.
pub const MAX_PARTICIPANTS: u32 = 13;
const TTL_THRESHOLD: u32 = 7 * 17_280;
const TTL_TARGET: u32 = 30 * 17_280;

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

// Private, fixed-shape persistent representation. The recipient lives in the
// key; equal amounts are derived from total and canonical participant order.
// Two bits per participant encode outstanding/paid/cancelled. Ledger slots are
// allocated at creation so settlement cannot grow the entry's rent footprint.
// A tuple avoids storing repeated field names on every participant.
#[contracttype]
#[derive(Clone)]
struct StoredSplit(i128, Vec<Address>, u32, Vec<u32>, u32);

impl StoredSplit {
    fn amount(&self, index: u32) -> i128 {
        let count = i128::from(self.1.len());
        self.0 / count + i128::from(i128::from(index) < self.0 % count)
    }

    fn state(&self, index: u32, organizer: &Address) -> ShareState {
        if self.1.get_unchecked(index) == *organizer {
            return ShareState::Organizer;
        }
        match (self.2 >> (2 * index)) & 3 {
            1 => ShareState::Paid(self.3.get_unchecked(index)),
            2 => ShareState::Cancelled(self.3.get_unchecked(index)),
            _ => ShareState::Outstanding,
        }
    }

    fn finish(&mut self, index: u32, state: u32, ledger: u32) {
        self.2 |= state << (2 * index);
        self.3.set(index, ledger);
    }

    fn public(&self, env: &Env, organizer: &Address) -> Split {
        let mut shares = Vec::new(env);
        for (index, participant) in self.1.iter().enumerate() {
            shares.push_back(Share {
                participant,
                amount: self.amount(index as u32),
                state: self.state(index as u32, organizer),
            });
        }
        Split {
            recipient: organizer.clone(),
            total: self.0,
            shares,
            created_ledger: self.4,
        }
    }
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

fn extend(env: &Env, key: &DataKey) {
    let target = TTL_TARGET.min(env.storage().max_ttl());
    let threshold = TTL_THRESHOLD.min(target);
    // Shared instance/WASM rent is an operator maintenance concern, never an
    // unpredictable bill attached to an organizer's creation or a payment.
    env.storage()
        .persistent()
        .extend_ttl(key, threshold, target);
}

fn load(env: &Env, key: &DataKey) -> Result<StoredSplit, Error> {
    env.storage().persistent().get(key).ok_or(Error::NotFound)
}

fn save(env: &Env, key: &DataKey, split: &StoredSplit) {
    env.storage().persistent().set(key, split);
    extend(env, key);
}

fn outstanding(
    split: &StoredSplit,
    organizer: &Address,
    participant: &Address,
) -> Result<u32, Error> {
    for (index, address) in split.1.iter().enumerate() {
        if address == *participant {
            return match split.state(index as u32, organizer) {
                ShareState::Outstanding => Ok(index as u32),
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

        let key = DataKey::Split(organizer.clone(), split_id.clone());
        if let Some(existing) = env.storage().persistent().get::<_, StoredSplit>(&key) {
            if existing.0 != total || existing.1 != ordered {
                return Err(Error::ConflictingSplit);
            }
            extend(&env, &key);
            return Ok(false);
        }

        let mut ledgers = Vec::new(&env);
        for _ in 0..count {
            ledgers.push_back(0);
        }
        let split = StoredSplit(total, ordered, 0, ledgers, env.ledger().sequence());
        save(&env, &key, &split);
        SplitCreated {
            split: split.public(&env, &organizer),
            organizer,
            split_id,
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
        let index = outstanding(&split, &organizer, &participant)?;
        let amount = split.amount(index);
        let ledger = env.ledger().sequence();
        split.finish(index, 1, ledger);
        save(&env, &key, &split);
        // A failing transfer aborts this invocation, rolling back the settlement,
        // TTL updates, token changes, and events together. No caught token errors.
        TokenClient::new(&env, &token(&env)).transfer(&participant, &organizer, &amount);
        SharePaid {
            organizer,
            split_id,
            participant,
            amount,
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
        let index = outstanding(&split, &organizer, &participant)?;
        let amount = split.amount(index);
        let ledger = env.ledger().sequence();
        split.finish(index, 2, ledger);
        save(&env, &key, &split);
        ShareCancelled {
            organizer,
            split_id,
            participant,
            amount,
            ledger,
        }
        .publish(&env);
        Ok(())
    }

    /// Bounded public state. Reads do not renew rent; use keep_alive explicitly.
    pub fn get(env: Env, organizer: Address, split_id: BytesN<32>) -> Option<Split> {
        let key = DataKey::Split(organizer.clone(), split_id);
        env.storage()
            .persistent()
            .get::<_, StoredSplit>(&key)
            .map(|split| split.public(&env, &organizer))
    }

    pub fn usdc(env: Env) -> Address {
        token(&env)
    }

    /// Permissionless maintenance. Also works for fully settled/cancelled splits.
    pub fn keep_alive(env: Env, organizer: Address, split_id: BytesN<32>) -> Result<(), Error> {
        let key = DataKey::Split(organizer, split_id);
        load(&env, &key)?;
        extend(&env, &key);
        Ok(())
    }
}

#[cfg(test)]
mod test;
