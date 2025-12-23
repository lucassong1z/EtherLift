import { FhevmType } from "@fhevm/hardhat-plugin";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

task("task:addresses", "Print deployed contract addresses").setAction(async function (_taskArguments: TaskArguments, hre) {
  const { deployments } = hre;

  const cEth = await deployments.get("ERC7984ETH");
  const fundraiser = await deployments.get("EtherLiftFundraising");

  console.log("cETH token        :", cEth.address);
  console.log("Fundraising       :", fundraiser.address);
});

task("task:campaign", "Display campaign configuration").setAction(async function (_taskArguments: TaskArguments, hre) {
  const { deployments, ethers } = hre;

  const fundraiserDeployment = await deployments.get("EtherLiftFundraising");
  const fundraiser = await ethers.getContractAt("EtherLiftFundraising", fundraiserDeployment.address);

  const campaign = await fundraiser.getCampaign();
  const remaining = await fundraiser.timeRemaining();

  console.log("Campaign name     :", campaign[0]);
  console.log("Target (raw)      :", campaign[1].toString());
  console.log("End time          :", new Date(Number(campaign[2]) * 1000).toISOString());
  console.log("Is closed         :", campaign[3]);
  console.log("Time remaining(s) :", remaining.toString());
});

task("task:mint-ceth", "Mint cETH to an address")
  .addParam("to", "Recipient of cETH")
  .addParam("amount", "Token amount in 6 decimal units")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { deployments, ethers } = hre;

    const amount = BigInt(taskArguments.amount);
    const tokenDeployment = await deployments.get("ERC7984ETH");
    const token = await ethers.getContractAt("ERC7984ETH", tokenDeployment.address);
    const [signer] = await ethers.getSigners();

    const tx = await token.connect(signer).mint(taskArguments.to, amount);
    console.log(`Minting ${amount} cETH (raw units) to ${taskArguments.to}... tx=${tx.hash}`);
    await tx.wait();
    console.log("Mint complete.");
  });

task("task:set-operator", "Allow the fundraiser contract to transfer cETH on your behalf")
  .addOptionalParam("holder", "Address that grants operator permissions")
  .addOptionalParam("until", "Unix timestamp until the approval remains valid (seconds)")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { deployments, ethers } = hre;

    const fundraiserDeployment = await deployments.get("EtherLiftFundraising");
    const tokenDeployment = await deployments.get("ERC7984ETH");
    const token = await ethers.getContractAt("ERC7984ETH", tokenDeployment.address);
    const signers = await ethers.getSigners();
    const signer = taskArguments.holder ? await ethers.getSigner(taskArguments.holder) : signers[0];

    const expiry =
      taskArguments.until !== undefined
        ? Number(taskArguments.until)
        : Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

    const tx = await token.connect(signer).setOperator(fundraiserDeployment.address, expiry);
    console.log(`Setting operator for ${signer.address} until ${expiry}... tx=${tx.hash}`);
    await tx.wait();
    console.log("Operator set.");
  });

task("task:contribute", "Contribute encrypted cETH to the fundraiser")
  .addParam("amount", "Contribution amount in raw units (6 decimals)")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { deployments, ethers, fhevm } = hre;

    const amount = BigInt(taskArguments.amount);
    await fhevm.initializeCLIApi();

    const fundraiserDeployment = await deployments.get("EtherLiftFundraising");
    const tokenDeployment = await deployments.get("ERC7984ETH");
    const fundraiser = await ethers.getContractAt("EtherLiftFundraising", fundraiserDeployment.address);
    const [signer] = await ethers.getSigners();

    const encryptedInput = await fhevm
      .createEncryptedInput(tokenDeployment.address, fundraiserDeployment.address)
      .add64(amount)
      .encrypt();

    const tx = await fundraiser
      .connect(signer)
      .contribute(encryptedInput.handles[0], encryptedInput.inputProof);
    console.log(`Contributing ${amount} (raw) from ${signer.address}... tx=${tx.hash}`);
    await tx.wait();
    console.log("Contribution submitted.");
  });

task("task:decrypt", "Decrypt contribution and total raised")
  .addOptionalParam("user", "Address to decrypt contribution for (defaults to signer)")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { deployments, ethers, fhevm } = hre;

    await fhevm.initializeCLIApi();

    const fundraiserDeployment = await deployments.get("EtherLiftFundraising");
    const fundraiser = await ethers.getContractAt("EtherLiftFundraising", fundraiserDeployment.address);
    const [signer] = await ethers.getSigners();
    const targetAddress = taskArguments.user || signer.address;

    const encryptedContribution = await fundraiser.contributionOf(targetAddress);
    const encryptedTotal = await fundraiser.totalRaised();

    const clearContribution = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encryptedContribution,
      fundraiserDeployment.address,
      signer,
    );

    const clearTotal = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encryptedTotal,
      fundraiserDeployment.address,
      signer,
    );

    console.log(`Contribution for ${targetAddress}: ${clearContribution.toString()}`);
    console.log(`Total raised: ${clearTotal.toString()}`);
  });
