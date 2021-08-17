import * as helpers from "./helpers";
const constants = require("./helpers/constants");
const OMNGuild = artifacts.require("OMNGuild");
const Realitio = artifacts.require("Realitio");
const { soliditySha3 } = require("web3-utils");
const {
    fixSignature
} = require("./helpers/sign");
const {
    BN,
    expectEvent,
    expectRevert,
    balance,
    send,
    ether,
    time
} = require("@openzeppelin/test-helpers");
const {
    createAndSetupGuildToken,
    createGuildProposal,
} = require("./helpers/guild");

require("chai").should();

contract("OMNGuild", function(accounts) {

    const ZERO = new BN("0");
    const TIMELOCK = new BN("60");
    const VOTE_GAS = new BN("50000"); // 50k
    const MAX_GAS_PRICE = new BN("8000000000"); // 8 gwei
    const OMN_REWARD = 6;

    let guildToken,
        omnGuild,
        realitio,
        tokenVault,
        callData,
        genericCallData,
        questionId,
        guildProposalId,
        genericProposal,
        tx,
        marketValidationProposalValid,
        marketValidationProposalInvalid;

    beforeEach(async function() {
        guildToken = await createAndSetupGuildToken(
            accounts.slice(0, 5), [100, 50, 150, 150, 200]
        );
        omnGuild = await OMNGuild.new();
        realitio = await Realitio.new();

        await omnGuild.initialize(
            guildToken.address,  //  _token:
            60*60*24*7,  //  _proposalTime:
            130000,  //  _timeForExecution:
            40,  //  _votesForExecution:
            10,  //  _votesForCreation:
            VOTE_GAS,  //  _voteGas:
            MAX_GAS_PRICE,  //  _maxGasPrice:
            TIMELOCK,  //  _lockTime:
            99,  //  _maxAmountVotes:
            realitio.address,  //  _realitIO:
        );

        tokenVault = await omnGuild.tokenVault();

        await guildToken.approve(tokenVault, 60);
        await guildToken.approve(tokenVault, 50, { from: accounts[1] });
        await guildToken.approve(tokenVault, 100, { from: accounts[2] });
        await guildToken.approve(tokenVault, 150, { from: accounts[3] });
        await guildToken.approve(tokenVault, 200, { from: accounts[4] });

        await omnGuild.lockTokens(60);
        await omnGuild.lockTokens(50, { from: accounts[1] });
        await omnGuild.lockTokens(100, { from: accounts[2] });
        await omnGuild.lockTokens(150, { from: accounts[3] });
        await omnGuild.lockTokens(200, { from: accounts[4] });
        
        const data = await new web3.eth.Contract(
              OMNGuild.abi
            ).methods.setOMNGuildConfig(
                99, /// _maxAmountVotes The max amount of votes allowed ot have
                realitio.address, 
                2*OMN_REWARD, /// _successfulVoteReward The amount of OMN tokens in wei unit to be reward to a voter after a successful  vote
                OMN_REWARD /// _unsuccessfulVoteReward The amount of OMN tokens in wei unit to be reward to a voter after a unsuccessful vote
              ).encodeABI()
        guildProposalId = await createGuildProposal({
          guild: omnGuild,
          to: [omnGuild.address],
          data: [ data ],
          value: [0],
          description: "setOMNGuildConfig",
          contentHash: constants.NULL_ADDRESS,
          account: accounts[0],
        });

        await time.increase(time.duration.seconds(60*60*24*7+1000));
        
        await omnGuild.setPositiveVote(
            guildProposalId,
            40, {
                from: accounts[4]
            });

        const receipt = await omnGuild.endGuildProposal(guildProposalId);
        expectEvent(receipt, "GuildProposalExecuted", {
            guildProposalId: guildProposalId
        });

        const latest = (await time.latest()).toNumber();
        questionId = (await realitio.askQuestion(0 /* template_id */ , "Is market with [questionID] valid?", omnGuild.address, 60*60*24*2 /* timeout, */ , latest /* opening_ts */ , 0 /* nonce */ )).receipt.logs[0].args.question_id;

        await realitio.submitAnswer(questionId, soliditySha3((true)), 0, {
            value: 1
        });
        await realitio.submitAnswer(questionId, soliditySha3((false)), 0, {
            value: 2
        });
        tx = await omnGuild.createMarketValidationProposal(questionId);
        marketValidationProposalValid = tx.logs[0].args.proposalId;
        marketValidationProposalInvalid = tx.logs[2].args.proposalId;
    });

    describe("OMNGuild use tests", function() {

        it("vote on and execute a market validation proposal from the omn-guild", async function() {
            await expectRevert(
                omnGuild.endProposal(marketValidationProposalValid),
                "OMNGuild: use endGuildProposal or endMarketValidationProposal"
            );
            await expectRevert(
                omnGuild.endMarketValidationProposal(questionId),
                "ERC20Guild: Proposal hasnt ended yet"
            );
            await expectRevert(omnGuild.setVote(
                marketValidationProposalValid,
                999999, {
                    from: accounts[4]
                }),
                "OMNGuild: Invalid amount");
            await expectRevert(omnGuild.setVote(
                marketValidationProposalValid,
                100, {
                    from: accounts[4]
                }),
                "OMNGuild: Cant vote with more votes than max amount of votes");
            const txVote = await omnGuild.setVote(
                marketValidationProposalValid,
                20, {
                    from: accounts[4]
                });

            expectEvent(txVote, "VoteAdded", {
                proposalId: marketValidationProposalValid
            });

            await time.increase(time.duration.seconds(60*60*24*7+1000));

            if (constants.ARC_GAS_PRICE > 1)
                expect(txVote.receipt.gasUsed).to.be.below(80000);

            await expectRevert(
                omnGuild.endProposal(marketValidationProposalValid),
                "OMNGuild: use endGuildProposal or endMarketValidationProposal"
            );
            const receipt = await omnGuild.endMarketValidationProposal(questionId);
            expectEvent(receipt, "ProposalExecuted", {
                proposalId: marketValidationProposalValid
            });
            await expectRevert(
                omnGuild.endMarketValidationProposal(questionId),
                "ERC20Guild: Proposal already executed"
            );
            const proposalInfo = await omnGuild.getProposal(marketValidationProposalValid);
            assert.equal(proposalInfo.state, constants.GuildProposalState.Executed);
            assert.equal(proposalInfo.to[0], realitio.address);
            assert.equal(proposalInfo.value[0], 0);
            assert.equal(await realitio.isFinalized(questionId), true);
            assert.equal(await realitio.getFinalAnswer(questionId), soliditySha3((true)));
        });

        const msgD = "ERC20Guild: Proposal already executed";
        it(msgD, async function() {
            await expectRevert(
                omnGuild.endGuildProposal(guildProposalId),
                msgD
            );
        });


        it("test proposal failed/ended", async function() {
            const txVote = await omnGuild.setVote(
                marketValidationProposalValid,
                20, {
                    from: accounts[4]
                });
            await time.increase(time.duration.seconds(60*60*24*7+200000));
            const receipt = await omnGuild.endMarketValidationProposal(questionId);
            expectEvent(receipt, "ProposalEnded", {
                proposalId: marketValidationProposalValid
            });
            const proposalInfo = await omnGuild.getProposal(marketValidationProposalValid);
            assert.equal(proposalInfo.state, constants.GuildProposalState.Failed);

        });
        it("test proposal rejected", async function() {
            await time.increase(time.duration.seconds(60*60*24*7+100000));
            const receipt = await omnGuild.endMarketValidationProposal(questionId);
            expectEvent(receipt, "ProposalRejected", {
                proposalId: marketValidationProposalValid
            });
            const proposalInfo = await omnGuild.getProposal(marketValidationProposalValid);
            assert.equal(proposalInfo.state, constants.GuildProposalState.Rejected);

        });

        it("test changing vote I.B.3.c: Voters CANNOT change vote once they've voted", async function() {
            const txVote = await omnGuild.setVote(
                marketValidationProposalInvalid,
                1, {
                    from: accounts[4]
                });

            await expectRevert(
                omnGuild.setVote(
                    marketValidationProposalInvalid,
                    1, {
                        from: accounts[4]
                }),
                "OMNGuild: Already voted"
            );
            await expectRevert(
                omnGuild.setVote(
                    marketValidationProposalValid,
                    1, {
                        from: accounts[4]
                }),
                "OMNGuild: Already voted"
            );
        });

        it("test changing vote I.B.3.c: Voters CANNOT change vote once they've voted", async function() {
            const txVote = await omnGuild.setVote(
                marketValidationProposalValid,
                1, {
                    from: accounts[4]
                });

            await expectRevert(
                omnGuild.setVote(
                marketValidationProposalInvalid,
                1, {
                    from: accounts[4]
                }),
                "OMNGuild: Already voted"
            );
            await expectRevert(
                omnGuild.setVote(
                marketValidationProposalValid,
                1, {
                    from: accounts[4]
                }),
                "OMNGuild: Already voted"
            );
        });
        const msgE = "OMNGuild: Cant claim from proposal that isnt for market validation";
        it(msgE, async function() {
            const txVote = await omnGuild.setVote(
                marketValidationProposalValid,
                10, {
                    from: accounts[4]
                });
            expectEvent(txVote, "VoteAdded", {
                proposalId: marketValidationProposalValid
            });
            await expectRevert(
                omnGuild.claimMarketValidationVoteRewards(["0x123456789"],accounts[4]),
                msgE
            );
        });

        it("claim rewards for successful vote", async function() {
            const txVote = await omnGuild.setVote(
                marketValidationProposalValid,
                10, {
                    from: accounts[4]
                });
            expectEvent(txVote, "VoteAdded", {
                proposalId: marketValidationProposalValid
            });
            await expectRevert(
                omnGuild.claimMarketValidationVoteRewards([marketValidationProposalValid],accounts[4]),
                "OMNGuild: Proposal to claim should be executed or rejected"
            );

            await time.increase(time.duration.seconds(60*60*24*7+1000));

            const receipt = await omnGuild.endMarketValidationProposal(questionId);
            expectEvent(receipt, "ProposalExecuted", {
                proposalId: marketValidationProposalValid
            });
            const proposalInfo = await omnGuild.getProposal(marketValidationProposalValid);
            assert.equal(await realitio.isFinalized(questionId),true);
            assert.equal(await realitio.getFinalAnswer(questionId),  soliditySha3((true)));

            assert.equal(await guildToken.balanceOf(accounts[4]),0);
            await guildToken.transfer(omnGuild.address, 50, { from: accounts[2] });
            await omnGuild.claimMarketValidationVoteRewards([marketValidationProposalValid],accounts[4]);
            assert.equal(await guildToken.balanceOf(accounts[4]),2*OMN_REWARD);
            await expectRevert(
                omnGuild.claimMarketValidationVoteRewards([marketValidationProposalValid],accounts[4]),
                "OMNGuild: Vote reward already claimed"
            );
        });

        it("claim rewards for unsuccessful vote", async function() {
            const txVote = await omnGuild.setVote(
                marketValidationProposalValid,
                10, {
                    from: accounts[3]
                });
            expectEvent(txVote, "VoteAdded", {
                proposalId: marketValidationProposalValid
            });
            const txVote_ = await omnGuild.setVote(
                marketValidationProposalInvalid,
                9, {
                    from: accounts[4]
                });
            expectEvent(txVote_, "VoteAdded", {
                proposalId: marketValidationProposalInvalid
            });
            await expectRevert(
                omnGuild.claimMarketValidationVoteRewards([marketValidationProposalInvalid],accounts[4]),
                "OMNGuild: Proposal to claim should be executed or rejected"
            );

            await time.increase(time.duration.seconds(60*60*24*7+1000));

            const receipt = await omnGuild.endMarketValidationProposal(questionId);
            expectEvent(receipt, "ProposalExecuted", {
                proposalId: marketValidationProposalValid
            });
            assert.equal(await realitio.isFinalized(questionId),true);
            assert.equal(await realitio.getFinalAnswer(questionId),  soliditySha3((true)));
            assert.equal(await guildToken.balanceOf(accounts[4]),0);
            await expectRevert(
                omnGuild.claimMarketValidationVoteRewards([marketValidationProposalInvalid],accounts[4]),
                "OMNGuild: Rewards are temporarily unavailable. Please try again later.");
            await guildToken.transfer(omnGuild.address, 50, { from: accounts[2] });
            await omnGuild.claimMarketValidationVoteRewards([marketValidationProposalInvalid],accounts[4]);
            assert.equal(await guildToken.balanceOf(accounts[4]),OMN_REWARD);
            await expectRevert(
                omnGuild.claimMarketValidationVoteRewards([marketValidationProposalInvalid],accounts[4]),
                "OMNGuild: Vote reward already claimed"
            );
        });
        it("test setVotes prevents voting twice", async function() {
            await expectRevert (omnGuild.setVotes(
                    [marketValidationProposalInvalid,
                    marketValidationProposalInvalid],
                    [10000,999,888], 
                    { from: accounts[4] }),
                "OMNGuild: Wrong length of proposalIds or amounts");
            await expectRevert (omnGuild.setVotes(
                    [marketValidationProposalInvalid,
                    marketValidationProposalInvalid],
                    [10000,999], 
                    { from: accounts[4] }),
                "OMNGuild: Invalid amount");
            await expectRevert (omnGuild.setVotes(
                    [marketValidationProposalInvalid,
                    marketValidationProposalInvalid],
                    [100,100], 
                    { from: accounts[4] }),
                "OMNGuild: Cant vote with more votes than max amount of votes");
            await expectRevert (omnGuild.setVotes(
                    [marketValidationProposalInvalid,
                    marketValidationProposalInvalid],
                    [10,9], 
                    { from: accounts[4] }),
                "OMNGuild: Already voted");
            await expectRevert (omnGuild.setVotes(
                    [marketValidationProposalInvalid,
                    marketValidationProposalValid],
                    [10,9], 
                    { from: accounts[3] }),
                "OMNGuild: Already voted");
            await expectRevert (omnGuild.setVotes(
                    [marketValidationProposalValid,
                    marketValidationProposalValid],
                    [10,9], 
                    { from: accounts[3] }),
                "OMNGuild: Already voted");
        });
        it("test setVotes prevents changing vote", async function() {
            await expectRevert (omnGuild.setVotes(
                    [marketValidationProposalValid,
                    marketValidationProposalInvalid],
                    [10,9], 
                    { from: accounts[3] }),
                "OMNGuild: Already voted");
        });
        
        it("test createProposal", async function() {
            const testData = await new web3.eth.Contract(
                  OMNGuild.abi
                ).methods.getVotesForExecution().encodeABI();
            await expectRevert(
                omnGuild.createProposal(
                    [ accounts[0] ],  //  to:
                    [ testData ],  //  data:
                    [ 0 ],  //  value:
                    "allow functions to anywhere",  //  description:
                    constants.NULL_ADDRESS,  //  contentHash:
                ), 
                "OMNGuild: use createGuildProposal");
        });

        it("test createGuildProposal passing proposal", async function() {
            await expectRevert(omnGuild.setSpecialProposerPermission(accounts[2],3,4), "Only callable by the guild");

            const testCall = web3.eth.abi.encodeFunctionSignature("getVotesForExecution()");
            const testData = await new web3.eth.Contract(
                  OMNGuild.abi
                ).methods.getVotesForExecution().encodeABI();
            const tx = await omnGuild.createGuildProposal(
                [ accounts[0] ],  //  to:
                [ testData ],  //  data:
                [ 0 ],  //  value:
                "allow functions to anywhere",  //  description:
                constants.NULL_ADDRESS,  //  contentHash:
            );
            const testProposal = helpers.getValueFromLogs(tx, "guildProposalId", "GuildProposalCreated");
            const setAllowanceData = await new web3.eth.Contract(
                  OMNGuild.abi
                ).methods.setAllowance(
                    [ accounts[0] ],
                    [ testCall ],  
                    [ true ], 
                  ).encodeABI()
            const setAllowanceProposalId = await createGuildProposal({
              guild: omnGuild,
              to: [ omnGuild.address ],
              data: [ setAllowanceData ],
              value: [0],
              description: "setAllowance",
              contentHash: constants.NULL_ADDRESS,
              account: accounts[1],
            });
            await omnGuild.setPositiveVote(
                setAllowanceProposalId,
                40, {
                    from: accounts[4]
                });

            await time.increase(time.duration.seconds(60*60*24*7+1000));
            await omnGuild.setPositiveVote(
                testProposal,
                40, {
                    from: accounts[4]
                });
            await expectRevert(omnGuild.endGuildProposal(testProposal), "Not allowed call");
            const setAllowanceReceipt = await omnGuild.endGuildProposal(setAllowanceProposalId);
            expectEvent(setAllowanceReceipt, "GuildProposalExecuted", {
                guildProposalId: setAllowanceProposalId
            });



            const data = await new web3.eth.Contract(
                  OMNGuild.abi
                ).methods.setSpecialProposerPermission(
                    accounts[0], // proposer
                    12000000,  // proposalTime
                    0, // votesForCreation
                  ).encodeABI()
            const setSpecialProposerPermissionProposalId = await createGuildProposal({
              guild: omnGuild,
              to: [ omnGuild.address ],
              data: [ data ],
              value: [0],
              description: "setSpecialProposerPermission",
              contentHash: constants.NULL_ADDRESS,
              account: accounts[1],
            });
            await omnGuild.setPositiveVote(
                setSpecialProposerPermissionProposalId,
                40, {
                    from: accounts[4]
                });
            
            await time.increase(time.duration.seconds(60*60*24*7+1000));
            const receipt = await omnGuild.endGuildProposal(setSpecialProposerPermissionProposalId);
            expectEvent(receipt, "SetSpecialProposerPermission", {
                _proposer: accounts[0],
                _proposalTime: "12000000",
                _votesForCreation: "0"
            });
            expectEvent(receipt, "GuildProposalExecuted", {
                guildProposalId: setSpecialProposerPermissionProposalId
            });

            const releaseReceipt = await omnGuild.releaseTokens(60); 
            expectEvent(releaseReceipt, "TokensReleased", {
                voter: accounts[0]
            });

            const tx2 = await omnGuild.createGuildProposal(
                [ accounts[0] ],  //  to:
                [ testData ],  //  data:
                [ 0 ],  //  value:
                "allow functions to anywhere",  //  description:
                constants.NULL_ADDRESS,  //  contentHash:
            );
            const testProposal2 = helpers.getValueFromLogs(tx2, "guildProposalId", "GuildProposalCreated");
            await omnGuild.setPositiveVote(
                testProposal2,
                40, {
                    from: accounts[4]
                });
            await time.increase(time.duration.seconds(11999998));
            await expectRevert(
               omnGuild.endGuildProposal(testProposal2),
               "ERC20Guild: Proposal hasnt ended yet");
            await time.increase(time.duration.seconds(4));
            const receiptForTestPropsal2 = await omnGuild.endGuildProposal(testProposal2);
            expectEvent(receiptForTestPropsal2,
                "GuildProposalExecuted", {
                guildProposalId: testProposal2
            });
        });

        it("test createGuildProposal failing proposal", async function() {

            const testCall = web3.eth.abi.encodeFunctionSignature("getVotesForExecution()");
            const setAllowanceData = await new web3.eth.Contract(
                  OMNGuild.abi
                ).methods.setAllowance(
                    [ accounts[0] ],
                    [ testCall ],  
                    [ true ], 
                  ).encodeABI()
            const setAllowanceProposalId = await createGuildProposal({
              guild: omnGuild,
              to: [ omnGuild.address ],
              data: [ setAllowanceData ],
              value: [0],
              description: "setAllowance",
              contentHash: constants.NULL_ADDRESS,
              account: accounts[1],
            });

            await time.increase(time.duration.seconds(60*60*24*7+1000));
            const setAllowanceReceipt = await omnGuild.endGuildProposal(setAllowanceProposalId);
            expectEvent(setAllowanceReceipt, "GuildProposalRejected", {
                guildProposalId: setAllowanceProposalId
            });
        });
    });
});

contract("OMNGuild", function(accounts) {

    const ZERO = new BN("0");
    const TIMELOCK = new BN("60");
    const VOTE_GAS = new BN("50000"); // 50k
    const MAX_GAS_PRICE = new BN("8000000000"); // 8 gwei
    const OMN_REWARD = 6;

    let guildToken,
        omnGuild,
        realitio,
        tokenVault,
        callData,
        genericCallData,
        questionId,
        genericProposal,
        tx,
        marketValidationProposalValid,
        marketValidationProposalInvalid;

    beforeEach(async function() {
        guildToken = await createAndSetupGuildToken(
            accounts.slice(0, 5), [100, 50, 150, 150, 200]
        );
        omnGuild = await OMNGuild.new();
        realitio = await Realitio.new();
        await guildToken.transfer(omnGuild.address, 50, { from: accounts[2] });

        await omnGuild.initialize(
            guildToken.address,  //  _token:
            60*60*24*7,  //  _proposalTime:
            130000,  //  _timeForExecution:
            40,  //  _votesForExecution:
            10,  //  _votesForCreation:
            VOTE_GAS,  //  _voteGas:
            MAX_GAS_PRICE,  //  _maxGasPrice:
            TIMELOCK,  //  _lockTime:
            99999,  //  _maxAmountVotes:
            realitio.address,  //  _realitIO:
        );


        tokenVault = await omnGuild.tokenVault();

        await guildToken.approve(tokenVault, 50, { from: accounts[1] });
        await guildToken.approve(tokenVault, 100, { from: accounts[2] });
        await guildToken.approve(tokenVault, 150, { from: accounts[3] });
        await guildToken.approve(tokenVault, 200, { from: accounts[4] });

        await omnGuild.lockTokens(50, { from: accounts[1] });
        await omnGuild.lockTokens(100, { from: accounts[2] });
        await omnGuild.lockTokens(150, { from: accounts[3] });
        await omnGuild.lockTokens(200, { from: accounts[4] });
        
    });

    describe("OMNGuild set up tests", function() {
        const msgA = "OMNGuild: Only the Guild can configure the guild";
        it(msgA, async function() {
            await expectRevert(
                omnGuild.setOMNGuildConfig( 1100, realitio.address, 2*OMN_REWARD, OMN_REWARD ),
                msgA
            );
        });
        const msgB="OMNGuild: Not enough tokens to create proposal";
        it(msgB, async function() {
            const data = await new web3.eth.Contract(
                  OMNGuild.abi
                ).methods.setOMNGuildConfig(
                    1100, /// _maxAmountVotes The max amount of votes allowed ot have
                    realitio.address, 
                    2*OMN_REWARD, /// _successfulVoteReward The amount of OMN tokens in wei unit to be reward to a voter after a successful  vote
                    OMN_REWARD /// _unsuccessfulVoteReward The amount of OMN tokens in wei unit to be reward to a voter after a unsuccessful vote
                  ).encodeABI()
            const guildProposalId = await createGuildProposal({
              guild: omnGuild,
              to: [omnGuild.address],
              data: [ data ],
              value: [0],
              description: "setOMNGuildConfig",
              contentHash: constants.NULL_ADDRESS,
              account: accounts[1],
            });

            await expectRevert(
                omnGuild.endGuildProposal(guildProposalId),
                "ERC20Guild: Proposal hasnt ended yet"
            );

            await time.increase(time.duration.seconds(60*60*24*7+1000));
            
            await omnGuild.setPositiveVote(
                guildProposalId,
                40, {
                    from: accounts[4]
                });

            const receipt = await omnGuild.endGuildProposal(guildProposalId);
            expectEvent(receipt, "GuildProposalExecuted", {
                guildProposalId: guildProposalId
            });

            const latest=(await time.latest()).toNumber();
            questionId = (await realitio.askQuestion(0 /* template_id */ , "Is market with [questionID] valid?", omnGuild.address, 60*60*24*2 /* timeout, */ , latest /* opening_ts */ , 0 /* nonce */ )).receipt.logs[0].args.question_id;
            await realitio.submitAnswer(questionId, soliditySha3((true)), 0, {
                value: 1
            });
            await realitio.submitAnswer(questionId, soliditySha3((false)), 0, {
                value: 2
            });
            await expectRevert(
                omnGuild.createMarketValidationProposal(questionId),
                msgB
            );
        });
        const msgC="Realit.io question is over 2 days old";
        it(msgC, async function() {
            const data = await new web3.eth.Contract(
                  OMNGuild.abi
                ).methods.setOMNGuildConfig(
                    1100, /// _maxAmountVotes The max amount of votes allowed ot have
                    realitio.address, 
                    2*OMN_REWARD, /// _successfulVoteReward The amount of OMN tokens in wei unit to be reward to a voter after a successful  vote
                    OMN_REWARD /// _unsuccessfulVoteReward The amount of OMN tokens in wei unit to be reward to a voter after a unsuccessful vote
                  ).encodeABI()
            const guildProposalId = await createGuildProposal({
              guild: omnGuild,
              to: [omnGuild.address],
              data: [ data ],
              value: [0],
              description: "setOMNGuildConfig",
              contentHash: constants.NULL_ADDRESS,
              account: accounts[1],
            });

            await time.increase(time.duration.seconds(60*60*24*7+1000));
            
            await omnGuild.setPositiveVote(
                guildProposalId,
                40, {
                    from: accounts[4]
                });

            const receipt = await omnGuild.endGuildProposal(guildProposalId);
            expectEvent(receipt, "GuildProposalExecuted", {
                guildProposalId: guildProposalId
            });

            const latest=(await time.latest()).toNumber();
            questionId = (await realitio.askQuestion(0 /* template_id */ , "Is market with [questionID] valid?", omnGuild.address, 60*60*24*2 /* timeout, */ , latest /* opening_ts */ , 0 /* nonce */ )).receipt.logs[0].args.question_id;
            await realitio.submitAnswer(questionId, soliditySha3((true)), 0, {
                value: 1
            });
            await realitio.submitAnswer(questionId, soliditySha3((false)), 0, {
                value: 2
            });
            await guildToken.approve(tokenVault, 60);
            await omnGuild.lockTokens(60);
            await time.increase(time.duration.seconds(60*60*24*7+1000));
            await expectRevert(
                omnGuild.createMarketValidationProposal(questionId),
                msgC
            );
        });
    });
});
