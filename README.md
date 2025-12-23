# EtherLift

EtherLift is a privacy-first fundraising dApp for Ethereum. It lets a single fundraiser run a confidential campaign
denominated in cETH, where individual contributions and the total raised stay encrypted on-chain using FHEVM. Only
authorized parties can decrypt their own contributions or the aggregate total, while the fundraiser can close the round
and withdraw the encrypted balance.

This repository contains the Solidity contracts, Hardhat deployment/test setup, and a React + Vite frontend in `home/`.

## Project Goals

- Provide a fundraising flow that does not reveal contributor amounts on-chain.
- Preserve on-chain verifiability of activity (events, timestamps) without revealing sensitive values.
- Offer a complete, working frontend that performs real encrypted reads and writes.
- Keep the implementation minimal and auditable: one campaign per contract instance.

## The Problem This Solves

Public blockchains make fundraising contributions fully transparent. This creates:

- Social pressure (contributors compare amounts).
- Strategic behavior (front-running of large donations).
- Privacy leakage for donors and organizers.
- Difficulty in funding sensitive causes where amounts must remain confidential.

EtherLift uses Fully Homomorphic Encryption (FHE) to keep donation amounts private while preserving the ability to
compute totals and withdraw funds.

## Advantages

- Confidential contributions: amounts are encrypted at the client and remain encrypted on-chain.
- Encrypted total raised: the total stays hidden while still being updatable.
- Selective disclosure: only the fundraiser and the contributor can decrypt their own amounts.
- Minimal surface area: one contract, one campaign, no upgradeability, no admin keys beyond the fundraiser address.
- Clear auditability: campaign metadata (name, target, end time, close status) remains readable.

## How It Works (High-Level Flow)

1. The fundraiser deploys `EtherLiftFundraising` with a campaign name, target amount, and end time.
2. Contributors receive or mint cETH (a confidential ERC7984 token used for testing).
3. Contributors grant the fundraiser contract operator rights on their cETH.
4. The frontend encrypts the contribution amount with Zama FHE tooling and submits it to `contribute`.
5. The contract updates the contributor balance and total raised (both encrypted).
6. The fundraiser can close the campaign at any time and receives the encrypted total.
7. Authorized users can decrypt their own values via the Zama relayer.

## Smart Contracts

### `contracts/EtherLiftFundraising.sol`

- `configureCampaign(name, targetAmount, endTime)` updates campaign metadata before closing.
- `contribute(encryptedAmount, inputProof)` transfers encrypted cETH and updates encrypted state.
- `closeCampaign()` closes the campaign and transfers the encrypted total to the fundraiser.
- `getCampaign()` returns public metadata.
- `totalRaised()` returns the encrypted total.
- `contributionOf(address)` returns the encrypted contribution for a contributor.

Important behaviors:

- Only the fundraiser can update or close the campaign.
- Contributions require the fundraiser contract to be an approved operator.
- End time is enforced on contributions.
- Target amount is informational; it does not block contributions or force closure.

### `contracts/ERC7984ETH.sol`

An ERC7984 confidential token used for the demo flow:

- Symbol: `cETH`
- Minting: enabled for testing via `mint(address, amount)`
- Amounts are encrypted with FHE, never stored in plaintext

## Frontend (React + Vite)

The frontend lives in `home/` and implements every workflow end-to-end:

- Connect wallet (Rainbow + wagmi).
- Read campaign state and encrypted balances (viem).
- Encrypt contributions and submit transactions (ethers).
- Set operator approval for the fundraiser contract.
- Mint cETH for testing.
- Decrypt user contribution and total raised via the Zama relayer.
- Allow the fundraiser to update campaign details and close the round.

Important frontend conventions:

- Contract addresses and ABI are stored in `home/src/config/contracts.ts`.
- Do not import JSON ABI files in the frontend. Copy ABI content into the TS config file.
- The frontend does not use environment variables for configuration.

## Tech Stack

- Smart contracts: Solidity 0.8.27, Hardhat, hardhat-deploy
- Confidential computing: Zama FHEVM, ERC7984
- Tests: Mocha + Chai + FHEVM mock
- Frontend: React, Vite, TypeScript
- Web3:
  - Read: viem
  - Write: ethers
  - Wallet UX: Rainbow + wagmi

## Repository Layout

```
contracts/            Core Solidity contracts
deploy/               Deployment scripts
deployments/          Network deployments (ABI + addresses)
tasks/                Hardhat tasks (CLI utilities)
test/                 Contract tests
home/                 Frontend (React + Vite)
docs/                 Zama relayer and FHEVM references
```

## Setup

### Prerequisites

- Node.js 20+
- npm

### Install

```bash
npm install
```

### Environment Variables (Backend Only)

Create a `.env` file in the project root with:

```
INFURA_API_KEY=...
PRIVATE_KEY=...
ETHERSCAN_API_KEY=...   # optional
CAMPAIGN_NAME=...       # optional
CAMPAIGN_TARGET=...     # optional, raw units (6 decimals)
CAMPAIGN_ENDTIME=...    # optional, unix timestamp
```

Notes:

- Deployment uses `PRIVATE_KEY` (no mnemonic).
- `CAMPAIGN_TARGET` is in raw cETH units (6 decimals).
- `CAMPAIGN_ENDTIME` must be in the future.

### Compile and Test

```bash
npm run compile
npm run test
```

Tests rely on the FHEVM mock and validate:

- Campaign metadata is stored correctly.
- Encrypted contributions update contributor and total balances.
- End time prevents late contributions.
- Close transfers encrypted funds to the fundraiser.

## Deployment

### Local Network (for contract development)

```bash
npx hardhat node
npx hardhat deploy --network hardhat
```

### Sepolia

```bash
npx hardhat deploy --network sepolia
```

After deployment:

- Use `npx hardhat task:addresses` to print deployed addresses.
- Copy the ABI from `deployments/sepolia` into `home/src/config/contracts.ts`.
- Replace `FUNDRAISER_ADDRESS` and `CETH_ADDRESS` in `home/src/config/contracts.ts` with Sepolia addresses.

## Frontend Usage

From `home/`:

```bash
npm install
npm run dev
```

Then:

1. Connect a wallet on Sepolia.
2. Mint cETH for your address (testing only).
3. Authorize the fundraiser contract as an operator.
4. Submit an encrypted contribution.
5. Decrypt your contribution and total via the relayer.
6. If you are the fundraiser, update campaign details or close the round.

## Hardhat Tasks

Useful CLI helpers in `tasks/`:

- `npx hardhat task:addresses` print deployed contract addresses
- `npx hardhat task:campaign` show current campaign configuration
- `npx hardhat task:mint-ceth --to <address> --amount <raw>` mint test cETH
- `npx hardhat task:set-operator --holder <address> --until <timestamp>` approve operator
- `npx hardhat task:contribute --amount <raw>` submit encrypted contribution
- `npx hardhat task:decrypt --user <address>` decrypt contribution + total

## Security and Limitations

- Single-campaign contract per deployment.
- No refunds or partial withdrawals.
- No automatic closure when target is reached.
- Encrypted values cannot be read without proper FHE decryption and permissions.
- FHE operations are more expensive than standard ERC20 transfers.
- Decryption relies on the Zama relayer and user-signed EIP-712 messages.

## Future Roadmap

- Multi-campaign factory with shared UI.
- Refunds and emergency cancellation flows.
- Milestone-based releases and escrow mechanics.
- Support for additional confidential assets.
- Contribution proofs for selective disclosure.
- Improved analytics without revealing raw amounts.

## License

BSD-3-Clause-Clear. See `LICENSE`.
