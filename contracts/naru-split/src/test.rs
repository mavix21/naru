extern crate std;

use super::*;
use soroban_sdk::{
    Bytes, Event, IntoVal, Symbol,
    testutils::{
        Address as _, AuthorizedFunction, AuthorizedInvocation, EnvTestConfig, Events, Ledger,
        MockAuth, MockAuthInvoke, storage::Persistent,
    },
    token::StellarAssetClient,
    xdr,
};
use std::{rc::Rc, str::FromStr};

const ISSUER: &str = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

struct Fixture {
    env: Env,
    contract: Address,
    organizer: Address,
    alice: Address,
    bob: Address,
    id: BytesN<32>,
}

impl Fixture {
    fn new() -> Self {
        let env = Env::new_with_config(EnvTestConfig {
            capture_snapshot_at_drop: false,
        });
        env.ledger().with_mut(|l| {
            l.sequence_number = 100;
            l.min_persistent_entry_ttl = 100;
            l.max_entry_ttl = 3_110_400;
        });
        let network = env.crypto().sha256(&Bytes::from_slice(
            &env,
            b"Test SDF Network ; September 2015",
        ));
        env.ledger().with_mut(|l| l.network_id = network.to_array());

        // Real host SAC, for the exact official Testnet asset/address in this
        // in-memory ledger. No replacement-token implementation or token override.
        let issuer = xdr::AccountId::from_str(ISSUER).unwrap();
        env.host()
            .add_ledger_entry(
                &Rc::new(xdr::LedgerKey::Account(xdr::LedgerKeyAccount {
                    account_id: issuer.clone(),
                })),
                &Rc::new(xdr::LedgerEntry {
                    data: xdr::LedgerEntryData::Account(xdr::AccountEntry {
                        account_id: issuer.clone(),
                        balance: 0,
                        flags: 2, // AUTH_REVOCABLE: exercise a rejected recipient.
                        home_domain: Default::default(),
                        inflation_dest: None,
                        num_sub_entries: 0,
                        seq_num: xdr::SequenceNumber(0),
                        thresholds: xdr::Thresholds([1; 4]),
                        signers: Default::default(),
                        ext: xdr::AccountEntryExt::V0,
                    }),
                    last_modified_ledger_seq: 0,
                    ext: xdr::LedgerEntryExt::V0,
                }),
                None,
            )
            .unwrap();
        env.host()
            .invoke_function(xdr::HostFunction::CreateContract(xdr::CreateContractArgs {
                contract_id_preimage: xdr::ContractIdPreimage::Asset(xdr::Asset::CreditAlphanum4(
                    xdr::AlphaNum4 {
                        asset_code: xdr::AssetCode4(*b"USDC"),
                        issuer,
                    },
                )),
                executable: xdr::ContractExecutable::StellarAsset,
            }))
            .unwrap();
        let contract = env.register(NaruSplit, ());
        let organizer = Address::generate(&env);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let id = BytesN::from_array(&env, &[1; 32]);
        Self {
            env,
            contract,
            organizer,
            alice,
            bob,
            id,
        }
    }

    fn client(&self) -> NaruSplitClient<'_> {
        NaruSplitClient::new(&self.env, &self.contract)
    }

    fn participants(&self) -> Vec<Address> {
        soroban_sdk::vec![
            &self.env,
            self.bob.clone(),
            self.organizer.clone(),
            self.alice.clone()
        ]
    }

    fn create(&self, total: i128) -> bool {
        let participants = self.participants();
        self.client()
            .mock_auths(&[MockAuth {
                address: &self.organizer,
                invoke: &MockAuthInvoke {
                    contract: &self.contract,
                    fn_name: "create",
                    args: (&self.organizer, &self.id, total, &participants).into_val(&self.env),
                    sub_invokes: &[],
                },
            }])
            .create(&self.organizer, &self.id, &total, &participants)
    }

    fn get(&self) -> Split {
        self.client().get(&self.organizer, &self.id).unwrap()
    }

    fn share(&self, address: &Address) -> Share {
        self.get()
            .shares
            .iter()
            .find(|s| s.participant == *address)
            .unwrap()
    }

    fn mint(&self, address: &Address, amount: i128) {
        // Only test funding uses blanket auth. Contract actions use exact trees.
        StellarAssetClient::new(&self.env, &token(&self.env))
            .mock_all_auths()
            .mint(address, &amount);
        self.env.set_auths(&[]);
    }

    fn balance(&self, address: &Address) -> i128 {
        TokenClient::new(&self.env, &token(&self.env)).balance(address)
    }

    fn pay(&self, participant: &Address) {
        let amount = self.share(participant).amount;
        let usdc = token(&self.env);
        self.client()
            .mock_auths(&[MockAuth {
                address: participant,
                invoke: &MockAuthInvoke {
                    contract: &self.contract,
                    fn_name: "pay",
                    args: (&self.organizer, &self.id, participant).into_val(&self.env),
                    sub_invokes: &[MockAuthInvoke {
                        contract: &usdc,
                        fn_name: "transfer",
                        args: (participant, &self.organizer, amount).into_val(&self.env),
                        sub_invokes: &[],
                    }],
                },
            }])
            .pay(&self.organizer, &self.id, participant);
    }

    fn cancel(&self, participant: &Address) {
        self.client()
            .mock_auths(&[MockAuth {
                address: &self.organizer,
                invoke: &MockAuthInvoke {
                    contract: &self.contract,
                    fn_name: "cancel",
                    args: (&self.organizer, &self.id, participant).into_val(&self.env),
                    sub_invokes: &[],
                },
            }])
            .cancel(&self.organizer, &self.id, participant);
    }

    fn auth(&self, signer: &Address, method: &str, args: Vec<soroban_sdk::Val>) {
        self.env.mock_auths(&[MockAuth {
            address: signer,
            invoke: &MockAuthInvoke {
                contract: &self.contract,
                fn_name: method,
                args,
                sub_invokes: &[],
            },
        }]);
    }
}

#[test]
fn equal_shares_round_canonically_conserve_total_and_include_organizer() {
    for count in 2..=MAX_PARTICIPANTS {
        for total in [
            i128::from(count),
            i128::from(count) + 1,
            10_000_001,
            i128::MAX,
        ] {
            let f = Fixture::new();
            let mut participants = soroban_sdk::vec![&f.env, f.organizer.clone()];
            for _ in 1..count {
                participants.push_front(Address::generate(&f.env));
            }
            f.auth(
                &f.organizer,
                "create",
                (&f.organizer, &f.id, total, &participants).into_val(&f.env),
            );
            assert!(
                f.client()
                    .create(&f.organizer, &f.id, &total, &participants)
            );
            let split = f.get();
            assert_eq!(split.shares.iter().map(|s| s.amount).sum::<i128>(), total);
            for (index, share) in split.shares.iter().enumerate() {
                assert_eq!(
                    share.amount,
                    total / i128::from(count)
                        + i128::from((index as i128) < total % i128::from(count))
                );
                if index > 0 {
                    assert!(
                        split.shares.get_unchecked(index as u32 - 1).participant
                            < share.participant
                    );
                }
            }
            assert_eq!(f.share(&f.organizer).state, ShareState::Organizer);
            assert_eq!(
                split
                    .shares
                    .iter()
                    .filter(|s| s.state == ShareState::Outstanding)
                    .count(),
                (count - 1) as usize
            );
            // A different input order has the same terms and creates no second event.
            let reversed: Vec<Address> = Vec::from_iter(&f.env, participants.iter().rev());
            f.auth(
                &f.organizer,
                "create",
                (&f.organizer, &f.id, total, &reversed).into_val(&f.env),
            );
            assert!(!f.client().create(&f.organizer, &f.id, &total, &reversed));
            assert!(f.env.events().all().events().is_empty());
        }
    }
}

#[test]
fn invalid_participants_and_amounts_never_create_records() {
    let f = Fixture::new();
    let mut too_many = f.participants();
    for _ in 3..=MAX_PARTICIPANTS {
        too_many.push_back(Address::generate(&f.env));
    }
    let cases = [
        (Vec::new(&f.env), 30, Error::InvalidCount),
        (
            soroban_sdk::vec![&f.env, f.organizer.clone()],
            30,
            Error::InvalidCount,
        ),
        (too_many, 30, Error::InvalidCount),
        (
            soroban_sdk::vec![
                &f.env,
                f.organizer.clone(),
                f.alice.clone(),
                f.alice.clone()
            ],
            30,
            Error::DuplicateParticipant,
        ),
        (
            soroban_sdk::vec![&f.env, f.alice.clone(), f.bob.clone()],
            30,
            Error::MissingOrganizer,
        ),
        (f.participants(), 0, Error::InvalidAmount),
        (f.participants(), -1, Error::InvalidAmount),
        (f.participants(), i128::MIN, Error::InvalidAmount),
        (f.participants(), 2, Error::InvalidAmount),
    ];
    for (participants, total, error) in cases {
        f.auth(
            &f.organizer,
            "create",
            (&f.organizer, &f.id, total, &participants).into_val(&f.env),
        );
        assert_eq!(
            f.client()
                .try_create(&f.organizer, &f.id, &total, &participants),
            Err(Ok(error))
        );
        assert_eq!(f.client().get(&f.organizer, &f.id), None);
    }
}

#[test]
fn creation_requires_exact_organizer_authorization_even_for_retries() {
    let f = Fixture::new();
    let participants = f.participants();
    assert!(
        f.client()
            .try_create(&f.organizer, &f.id, &30, &participants)
            .is_err()
    );
    f.auth(
        &f.alice,
        "create",
        (&f.organizer, &f.id, 30_i128, &participants).into_val(&f.env),
    );
    assert!(
        f.client()
            .try_create(&f.organizer, &f.id, &30, &participants)
            .is_err()
    );
    f.auth(
        &f.organizer,
        "create",
        (&f.organizer, &f.id, 31_i128, &participants).into_val(&f.env),
    );
    assert!(
        f.client()
            .try_create(&f.organizer, &f.id, &30, &participants)
            .is_err()
    );
    assert_eq!(f.client().get(&f.organizer, &f.id), None);
    f.create(30);
    assert_eq!(
        f.env.auths(),
        std::vec![(
            f.organizer.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    f.contract.clone(),
                    Symbol::new(&f.env, "create"),
                    (&f.organizer, &f.id, 30_i128, &participants).into_val(&f.env)
                )),
                sub_invocations: std::vec![],
            }
        )]
    );
    f.env.set_auths(&[]);
    assert!(
        f.client()
            .try_create(&f.organizer, &f.id, &30, &participants)
            .is_err()
    );
}

#[test]
fn retries_compare_immutable_terms_and_ids_are_organizer_scoped() {
    let f = Fixture::new();
    f.create(30);
    let initial = f.get();
    let replacement = Address::generate(&f.env);
    for (total, participants) in [
        (31, f.participants()),
        (
            30,
            soroban_sdk::vec![&f.env, f.organizer.clone(), f.alice.clone()],
        ),
        (
            30,
            soroban_sdk::vec![&f.env, f.organizer.clone(), f.alice.clone(), replacement],
        ),
    ] {
        f.auth(
            &f.organizer,
            "create",
            (&f.organizer, &f.id, total, &participants).into_val(&f.env),
        );
        assert_eq!(
            f.client()
                .try_create(&f.organizer, &f.id, &total, &participants),
            Err(Ok(Error::ConflictingSplit))
        );
        assert_eq!(f.get(), initial);
    }
    let participants = f.participants();
    f.auth(
        &f.alice,
        "create",
        (&f.alice, &f.id, 60_i128, &participants).into_val(&f.env),
    );
    assert!(f.client().create(&f.alice, &f.id, &60, &participants));
    assert_eq!(f.client().get(&f.alice, &f.id).unwrap().recipient, f.alice);
    assert_eq!(f.get(), initial);
}

#[test]
fn payment_auth_covers_both_exact_root_and_nested_transfer() {
    let f = Fixture::new();
    f.create(30);
    f.mint(&f.alice, 20);
    let before = f.get();
    assert!(f.client().try_pay(&f.organizer, &f.id, &f.alice).is_err());
    let usdc = token(&f.env);
    let wrong_token = Address::generate(&f.env);
    let wrong_id = BytesN::from_array(&f.env, &[2; 32]);
    // Wrong signer, root-only, wrong amount, wrong recipient, wrong token, or
    // wrong split ID. None may debit or mark the request paid.
    for case in 0..6 {
        let child = MockAuthInvoke {
            contract: if case == 4 { &wrong_token } else { &usdc },
            fn_name: "transfer",
            args: (
                &f.alice,
                if case == 3 { &f.bob } else { &f.organizer },
                if case == 2 { 11_i128 } else { 10_i128 },
            )
                .into_val(&f.env),
            sub_invokes: &[],
        };
        f.env.mock_auths(&[MockAuth {
            address: if case == 0 { &f.organizer } else { &f.alice },
            invoke: &MockAuthInvoke {
                contract: &f.contract,
                fn_name: "pay",
                args: (
                    &f.organizer,
                    if case == 5 { &wrong_id } else { &f.id },
                    &f.alice,
                )
                    .into_val(&f.env),
                sub_invokes: if case == 1 {
                    &[]
                } else {
                    std::slice::from_ref(&child)
                },
            },
        }]);
        assert!(
            f.client().try_pay(&f.organizer, &f.id, &f.alice).is_err(),
            "case {case}"
        );
        assert!(f.env.events().all().events().is_empty());
        assert_eq!(f.get(), before);
        assert_eq!(f.balance(&f.alice), 20);
        assert_eq!(f.balance(&f.organizer), 0);
    }
    // A bare token-transfer authorization cannot be consumed through NaruSplit.
    f.env.mock_auths(&[MockAuth {
        address: &f.alice,
        invoke: &MockAuthInvoke {
            contract: &usdc,
            fn_name: "transfer",
            args: (&f.alice, &f.organizer, 10_i128).into_val(&f.env),
            sub_invokes: &[],
        },
    }]);
    assert!(f.client().try_pay(&f.organizer, &f.id, &f.alice).is_err());
    f.pay(&f.alice);
    assert_eq!(
        f.env.auths(),
        std::vec![(
            f.alice.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    f.contract.clone(),
                    Symbol::new(&f.env, "pay"),
                    (&f.organizer, &f.id, &f.alice).into_val(&f.env)
                )),
                sub_invocations: std::vec![AuthorizedInvocation {
                    function: AuthorizedFunction::Contract((
                        usdc,
                        Symbol::new(&f.env, "transfer"),
                        (&f.alice, &f.organizer, 10_i128).into_val(&f.env)
                    )),
                    sub_invocations: std::vec![],
                }],
            }
        )]
    );
    assert_eq!(f.share(&f.alice).state, ShareState::Paid(100));
    assert_eq!(f.balance(&f.alice), 10);
    assert_eq!(f.balance(&f.organizer), 10);
    assert_eq!(f.balance(&f.contract), 0);
}

#[test]
fn only_organizer_can_cancel_and_authorization_is_request_specific() {
    let f = Fixture::new();
    f.create(30);
    let before = f.get();
    f.env.set_auths(&[]);
    assert!(
        f.client()
            .try_cancel(&f.organizer, &f.id, &f.alice)
            .is_err()
    );
    f.auth(
        &f.alice,
        "cancel",
        (&f.organizer, &f.id, &f.alice).into_val(&f.env),
    );
    assert!(
        f.client()
            .try_cancel(&f.organizer, &f.id, &f.alice)
            .is_err()
    );
    f.auth(
        &f.organizer,
        "cancel",
        (&f.organizer, &f.id, &f.bob).into_val(&f.env),
    );
    assert!(
        f.client()
            .try_cancel(&f.organizer, &f.id, &f.alice)
            .is_err()
    );
    assert_eq!(f.get(), before);
    f.cancel(&f.alice);
    assert_eq!(f.share(&f.alice).state, ShareState::Cancelled(100));
    assert_eq!(f.share(&f.bob).state, ShareState::Outstanding);
}

#[test]
fn paid_and_cancelled_are_terminal_in_both_orderings_and_retries() {
    let f = Fixture::new();
    f.create(30);
    f.mint(&f.alice, 20);
    f.mint(&f.bob, 20);
    f.pay(&f.alice);
    f.env.ledger().set_sequence_number(101);
    f.cancel(&f.bob);
    let terminal = f.get();
    for (participant, expected) in [
        (&f.alice, Error::AlreadyPaid),
        (&f.bob, Error::Cancelled),
        (&f.organizer, Error::OrganizerShare),
    ] {
        f.auth(
            participant,
            "pay",
            (&f.organizer, &f.id, participant).into_val(&f.env),
        );
        assert_eq!(
            f.client().try_pay(&f.organizer, &f.id, participant),
            Err(Ok(expected))
        );
        f.auth(
            &f.organizer,
            "cancel",
            (&f.organizer, &f.id, participant).into_val(&f.env),
        );
        assert_eq!(
            f.client().try_cancel(&f.organizer, &f.id, participant),
            Err(Ok(expected))
        );
    }
    assert!(!f.create(30));
    assert_eq!(f.get(), terminal);
    assert_eq!(f.balance(&f.alice), 10);
    assert_eq!(f.balance(&f.bob), 20);
    assert_eq!(f.balance(&f.organizer), 10);
}

#[test]
fn outsider_and_unknown_split_cannot_be_settled_or_cancelled() {
    let f = Fixture::new();
    let unknown = Address::generate(&f.env);
    f.auth(
        &f.alice,
        "pay",
        (&f.organizer, &f.id, &f.alice).into_val(&f.env),
    );
    assert_eq!(
        f.client().try_pay(&f.organizer, &f.id, &f.alice),
        Err(Ok(Error::NotFound))
    );
    f.auth(
        &f.organizer,
        "cancel",
        (&f.organizer, &f.id, &f.alice).into_val(&f.env),
    );
    assert_eq!(
        f.client().try_cancel(&f.organizer, &f.id, &f.alice),
        Err(Ok(Error::NotFound))
    );
    assert_eq!(
        f.client().try_keep_alive(&f.organizer, &f.id),
        Err(Ok(Error::NotFound))
    );
    f.create(30);
    f.auth(
        &unknown,
        "pay",
        (&f.organizer, &f.id, &unknown).into_val(&f.env),
    );
    assert_eq!(
        f.client().try_pay(&f.organizer, &f.id, &unknown),
        Err(Ok(Error::NotParticipant))
    );
    f.auth(
        &f.organizer,
        "cancel",
        (&f.organizer, &f.id, &unknown).into_val(&f.env),
    );
    assert_eq!(
        f.client().try_cancel(&f.organizer, &f.id, &unknown),
        Err(Ok(Error::NotParticipant))
    );
}

#[test]
fn insufficient_funds_and_failed_recipient_transfer_roll_back_then_can_retry() {
    for reject_recipient in [false, true] {
        let f = Fixture::new();
        f.create(30);
        f.mint(&f.alice, if reject_recipient { 10 } else { 9 });
        f.mint(&f.organizer, 1);
        if reject_recipient {
            StellarAssetClient::new(&f.env, &token(&f.env))
                .mock_all_auths()
                .set_authorized(&f.organizer, &false);
        }
        let before = f.get();
        let balance = f.balance(&f.alice);
        let usdc = token(&f.env);
        f.env.mock_auths(&[MockAuth {
            address: &f.alice,
            invoke: &MockAuthInvoke {
                contract: &f.contract,
                fn_name: "pay",
                args: (&f.organizer, &f.id, &f.alice).into_val(&f.env),
                sub_invokes: &[MockAuthInvoke {
                    contract: &usdc,
                    fn_name: "transfer",
                    args: (&f.alice, &f.organizer, 10_i128).into_val(&f.env),
                    sub_invokes: &[],
                }],
            },
        }]);
        assert!(f.client().try_pay(&f.organizer, &f.id, &f.alice).is_err());
        assert!(f.env.events().all().events().is_empty());
        assert_eq!(f.get(), before);
        assert_eq!(f.balance(&f.alice), balance);
        assert_eq!(f.balance(&f.organizer), 1);
        if reject_recipient {
            StellarAssetClient::new(&f.env, &usdc)
                .mock_all_auths()
                .set_authorized(&f.organizer, &true);
        } else {
            f.mint(&f.alice, 1);
        }
        f.pay(&f.alice);
        assert_eq!(f.balance(&f.alice), 0);
        assert_eq!(f.balance(&f.organizer), 11);
        assert_eq!(f.share(&f.alice).state, ShareState::Paid(100));
    }
}

#[test]
fn lifecycle_events_match_state_and_retry_emits_nothing() {
    let f = Fixture::new();
    f.create(31);
    let created_events = f.env.events().all();
    let split = f.get();
    assert_eq!(
        created_events,
        std::vec![
            SplitCreated {
                organizer: f.organizer.clone(),
                split_id: f.id.clone(),
                split
            }
            .to_xdr(&f.env, &f.contract)
        ]
    );
    f.mint(&f.alice, 20);
    let amount = f.share(&f.alice).amount;
    f.pay(&f.alice);
    assert_eq!(
        f.env.events().all().events().last().unwrap(),
        &SharePaid {
            organizer: f.organizer.clone(),
            split_id: f.id.clone(),
            participant: f.alice.clone(),
            amount,
            ledger: 100
        }
        .to_xdr(&f.env, &f.contract)
    );
    let amount = f.share(&f.bob).amount;
    f.cancel(&f.bob);
    assert_eq!(
        f.env.events().all(),
        std::vec![
            ShareCancelled {
                organizer: f.organizer.clone(),
                split_id: f.id.clone(),
                participant: f.bob.clone(),
                amount,
                ledger: 100
            }
            .to_xdr(&f.env, &f.contract)
        ]
    );
    assert!(!f.create(31));
    assert!(f.env.events().all().events().is_empty());
}

#[test]
fn ttl_maintenance_and_archival_preserve_settlement_and_creation_guard() {
    let f = Fixture::new();
    f.create(30);
    f.mint(&f.alice, 20);
    f.pay(&f.alice);
    f.cancel(&f.bob);
    let terminal = f.get();
    let key = DataKey::Split(f.organizer.clone(), f.id.clone());
    let ttl = f
        .env
        .as_contract(&f.contract, || f.env.storage().persistent().get_ttl(&key));
    assert_eq!(ttl, TTL_TARGET);
    f.env
        .ledger()
        .set_sequence_number(100 + TTL_TARGET - TTL_THRESHOLD + 1);
    f.client().keep_alive(&f.organizer, &f.id);
    assert_eq!(
        f.env
            .as_contract(&f.contract, || f.env.storage().persistent().get_ttl(&key)),
        TTL_TARGET
    );
    // SDK emulates protocol-23+ automatic restoration. Creation is deliberately
    // the first access after archival: it must not reinterpret archived as new.
    f.env
        .ledger()
        .set_sequence_number(f.env.ledger().sequence() + TTL_TARGET + 1);
    assert!(!f.create(30));
    assert_eq!(f.get(), terminal);
    f.auth(
        &f.organizer,
        "create",
        (&f.organizer, &f.id, 33_i128, f.participants()).into_val(&f.env),
    );
    assert_eq!(
        f.client()
            .try_create(&f.organizer, &f.id, &33, &f.participants()),
        Err(Ok(Error::ConflictingSplit))
    );
    for (participant, expected) in [(&f.alice, Error::AlreadyPaid), (&f.bob, Error::Cancelled)] {
        f.auth(
            participant,
            "pay",
            (&f.organizer, &f.id, participant).into_val(&f.env),
        );
        assert_eq!(
            f.client().try_pay(&f.organizer, &f.id, participant),
            Err(Ok(expected))
        );
    }
    assert_eq!(f.balance(&f.organizer), 10);
}
