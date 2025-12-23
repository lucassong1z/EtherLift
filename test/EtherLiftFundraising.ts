import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { ERC7984ETH, EtherLiftFundraising, EtherLiftFundraising__factory } from "../types";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

async function deployFixture() {
  const cEthFactory = await ethers.getContractFactory("ERC7984ETH");
  const cEthToken = (await cEthFactory.deploy()) as ERC7984ETH;

  const now = Number((await ethers.provider.getBlock("latest"))?.timestamp ?? 0n);
  const endTime = now + 3600;

  const fundraiserFactory = (await ethers.getContractFactory("EtherLiftFundraising")) as EtherLiftFundraising__factory;
  const fundraiserContract = (await fundraiserFactory.deploy(
    await cEthToken.getAddress(),
    "Relief Pool",
    5_000_000,
    endTime,
  )) as EtherLiftFundraising;

  return { cEthToken, fundraiserContract };
}

describe("EtherLiftFundraising", function () {
  let signers: Signers;
  let cEthToken: ERC7984ETH;
  let fundraiser: EtherLiftFundraising;
  let fundraiserAddress: string;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2] };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn("This test suite requires the FHEVM mock");
      this.skip();
    }

    ({ cEthToken, fundraiserContract: fundraiser } = await deployFixture());
    fundraiserAddress = await fundraiser.getAddress();
  });

  it("stores campaign configuration and total starts at zero", async function () {
    const campaign = await fundraiser.getCampaign();
    expect(campaign[0]).to.eq("Relief Pool");
    expect(campaign[1]).to.eq(5_000_000);
    expect(campaign[3]).to.eq(false);

    const encryptedTotal = await fundraiser.totalRaised();
    expect(encryptedTotal).to.eq(ethers.ZeroHash);
  });

  it("accepts encrypted contributions and updates totals", async function () {
    const amount = 2_500_000n;
    const currentTimestamp = Number((await ethers.provider.getBlock("latest"))?.timestamp ?? 0n);
    const expiry = BigInt(currentTimestamp + 60 * 60);

    await cEthToken.connect(signers.alice).mint(signers.alice.address, amount);
    const opTx = await cEthToken.connect(signers.alice).setOperator(fundraiserAddress, expiry);
    await opTx.wait();

    const tokenAddress = await cEthToken.getAddress();
    const encrypted = await fhevm.createEncryptedInput(tokenAddress, fundraiserAddress).add64(amount).encrypt();

    const tx = await fundraiser.connect(signers.alice).contribute(encrypted.handles[0], encrypted.inputProof);
    await tx.wait();

    const encryptedContribution = await fundraiser.contributionOf(signers.alice.address);
    const clearContribution = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encryptedContribution,
      fundraiserAddress,
      signers.alice,
    );
    expect(clearContribution).to.eq(amount);

    const encryptedTotal = await fundraiser.totalRaised();
    const clearTotal = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encryptedTotal,
      fundraiserAddress,
      signers.alice,
    );
    expect(clearTotal).to.eq(amount);
  });

  it("prevents contributions after end time", async function () {
    const currentTimestamp = Number((await ethers.provider.getBlock("latest"))?.timestamp ?? 0n);
    const expiry = BigInt(currentTimestamp + 60 * 60);
    await cEthToken.connect(signers.alice).mint(signers.alice.address, 1_000_000);
    const opTx = await cEthToken.connect(signers.alice).setOperator(fundraiserAddress, expiry);
    await opTx.wait();

    const campaign = await fundraiser.getCampaign();
    const endTime = Number(campaign[2]);

    await ethers.provider.send("evm_setNextBlockTimestamp", [endTime + 1]);
    await ethers.provider.send("evm_mine", []);

    const tokenAddress = await cEthToken.getAddress();
    const encrypted = await fhevm.createEncryptedInput(tokenAddress, fundraiserAddress).add64(500_000).encrypt();

    await expect(
      fundraiser.connect(signers.alice).contribute(encrypted.handles[0], encrypted.inputProof),
    ).to.be.revertedWith("Past end time");
  });

  it("allows fundraiser to close and withdraw cETH", async function () {
    const amount = 750_000n;
    const currentTimestamp = Number((await ethers.provider.getBlock("latest"))?.timestamp ?? 0n);
    const expiry = BigInt(currentTimestamp + 60 * 60);

    await cEthToken.connect(signers.bob).mint(signers.bob.address, amount);
    const opTx = await cEthToken.connect(signers.bob).setOperator(fundraiserAddress, expiry);
    await opTx.wait();
    expect(await cEthToken.isOperator(signers.bob.address, fundraiserAddress)).to.eq(true);

    const tokenAddress = await cEthToken.getAddress();
    const encrypted = await fhevm.createEncryptedInput(tokenAddress, fundraiserAddress).add64(amount).encrypt();

    await fundraiser.connect(signers.bob).contribute(encrypted.handles[0], encrypted.inputProof);

    const closeTx = await fundraiser.connect(signers.deployer).closeCampaign();
    await closeTx.wait();
    expect(await fundraiser.isClosed()).to.eq(true);

    const encryptedBalance = await cEthToken.confidentialBalanceOf(signers.deployer.address);
    const clearBalance = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encryptedBalance,
      await cEthToken.getAddress(),
      signers.deployer,
    );
    expect(clearBalance).to.eq(amount);
  });
});
