// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.5.17;
pragma experimental ABIEncoderV2;

import "../erc20guild/ERC20Guild.sol";
import "openzeppelin-solidity/contracts/ownership/Ownable.sol";


/// @title DXDGuild
/// @author github:AugustoL
/// @notice This smart contract has not be audited.
/// An ERC20Guild that can only vote on a voting machine by calling the vote funtion
/// and can be configures only by its owner.
contract DXDGuild is ERC20Guild, Ownable {

  constructor() public ERC20Guild() {}
    
    /// @dev Initilizer
    /// @param _token The address of the token to be used
    /// @param _proposalTime The minimun time for a proposal to be under votation
    /// @param _votesForExecution The token votes needed for a proposal to be executed
    /// @param _votesForCreation The minimum balance of tokens needed to create a proposal
    /// @param _voteGas The gas to be used to calculate the vote gas refund
    /// @param _maxGasPrice The maximum gas price to be refunded
    /// @param _lockTime The minimum amount of seconds that the tokens would be locked

    /// @param votingMachine The voting machine where the guild will vote
    function initialize(
        address _token,
        uint256 _proposalTime,
        uint256 _votesForExecution,
        uint256 _votesForCreation,
        uint256 _voteGas,
        uint256 _maxGasPrice,
        uint256 _lockTime,
        address votingMachine
    ) public {
        super.initialize(
          _token, _proposalTime, _votesForExecution, _votesForCreation, "DXDGuild",  _voteGas, _maxGasPrice, _lockTime
        );
        callPermissions[votingMachine][bytes4(keccak256("vote(bytes32,uint256,uint256,address)"))] = true;
    }

}
