import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const campaignName = process.env.CAMPAIGN_NAME || "EtherLift Seed";
  const targetAmount = Number(process.env.CAMPAIGN_TARGET || "100000000"); // default: 100 cETH with 6 decimals
  const now = Math.floor(Date.now() / 1000);
  const endTime = Number(process.env.CAMPAIGN_ENDTIME || (now + 7 * 24 * 60 * 60));

  const cEth = await deploy("ERC7984ETH", {
    from: deployer,
    log: true,
  });

  const fundraiser = await deploy("EtherLiftFundraising", {
    from: deployer,
    args: [cEth.address, campaignName, targetAmount, endTime],
    log: true,
  });

  console.log(`cETH token: ${cEth.address}`);
  console.log(`EtherLiftFundraising: ${fundraiser.address}`);
};
export default func;
func.id = "deploy_etherlift"; // id required to prevent reexecution
func.tags = ["EtherLiftFundraising"];
