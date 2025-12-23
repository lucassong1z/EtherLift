// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";

import {ERC7984ETH} from "./ERC7984ETH.sol";

contract EtherLiftFundraising is ZamaEthereumConfig {
    struct Campaign {
        string name;
        uint64 targetAmount;
        uint64 endTime;
    }

    ERC7984ETH public immutable cEth;
    address public immutable fundraiser;

    Campaign private _campaign;
    euint64 private _totalRaised;
    bool public isClosed;
    uint256 public lastContributionAt;

    mapping(address contributor => euint64) private _contributions;

    event CampaignUpdated(string name, uint64 targetAmount, uint64 endTime);
    event ContributionReceived(address indexed contributor, euint64 encryptedAmount, uint256 timestamp);
    event CampaignClosed(address indexed fundraiser, euint64 encryptedAmount, uint256 timestamp);

    modifier onlyFundraiser() {
        require(msg.sender == fundraiser, "Only fundraiser");
        _;
    }

    constructor(address tokenAddress, string memory name, uint64 targetAmount, uint64 endTime) {
        require(tokenAddress != address(0), "Token required");
        fundraiser = msg.sender;
        cEth = ERC7984ETH(tokenAddress);
        _setCampaign(name, targetAmount, endTime);
    }

    function configureCampaign(string calldata name, uint64 targetAmount, uint64 endTime) external onlyFundraiser {
        _setCampaign(name, targetAmount, endTime);
    }

    function contribute(externalEuint64 encryptedAmount, bytes calldata inputProof) external returns (euint64) {
        require(!isClosed, "Campaign closed");
        require(block.timestamp <= _campaign.endTime, "Past end time");
        require(cEth.isOperator(msg.sender, address(this)), "Operator missing");

        euint64 transferred = cEth.confidentialTransferFrom(msg.sender, address(this), encryptedAmount, inputProof);

        euint64 newContribution = FHE.add(_contributions[msg.sender], transferred);
        FHE.allowThis(newContribution);
        FHE.allow(newContribution, msg.sender);
        FHE.allow(newContribution, fundraiser);
        _contributions[msg.sender] = newContribution;

        euint64 updatedTotal = FHE.add(_totalRaised, transferred);
        FHE.allowThis(updatedTotal);
        FHE.allow(updatedTotal, fundraiser);
        FHE.allow(updatedTotal, msg.sender);
        _totalRaised = updatedTotal;

        lastContributionAt = block.timestamp;

        emit ContributionReceived(msg.sender, transferred, block.timestamp);
        return newContribution;
    }

    function closeCampaign() external onlyFundraiser {
        require(!isClosed, "Already closed");
        isClosed = true;

        euint64 payout = _totalRaised;
        if (!FHE.isInitialized(payout)) {
            payout = FHE.asEuint64(0);
            FHE.allowThis(payout);
        }

        cEth.confidentialTransfer(fundraiser, payout);
        emit CampaignClosed(fundraiser, payout, block.timestamp);
    }

    function getCampaign() external view returns (string memory name, uint64 targetAmount, uint64 endTime, bool closed) {
        Campaign memory campaign = _campaign;
        return (campaign.name, campaign.targetAmount, campaign.endTime, isClosed);
    }

    function timeRemaining() external view returns (uint64) {
        if (block.timestamp >= _campaign.endTime) {
            return 0;
        }
        return uint64(_campaign.endTime - block.timestamp);
    }

    function totalRaised() external view returns (euint64) {
        return _totalRaised;
    }

    function contributionOf(address contributor) external view returns (euint64) {
        return _contributions[contributor];
    }

    function _setCampaign(string memory name, uint64 targetAmount, uint64 endTime) internal {
        require(!isClosed, "Campaign closed");
        require(bytes(name).length > 0, "Name required");
        require(targetAmount > 0, "Target required");
        require(endTime > block.timestamp, "End time must be in future");

        _campaign = Campaign({name: name, targetAmount: targetAmount, endTime: endTime});
        emit CampaignUpdated(name, targetAmount, endTime);
    }
}
