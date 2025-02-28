const User = require("../models/User");
const Campaign = require("../models/Campaign");
const ContributionTx = require("../models/ContributionTx");
const { info, err } = require("../utils/logger");
const deployContract = require("../web3/deploy");
const { loadContractAt, getRaisedAmount, getMaxAmountSoFar } = require("../web3/web3funding");
const auth = require("../middleware/auth");
const { ContributeGasLessly } = require("../web3/web3permit");
const { scheduleRefundCall } = require("../web3/web3Utils/web3ExpiryHandling");
const { getBalance } = require("../web3/web3Wallet");
const multer = require('multer');
const uploadImageToCloud = require("../utils/firebaseStorage");
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const web3RouterFunding = require("express").Router()

web3RouterFunding.get("/:cid", async (req, res) => {
    try {
        const contractraw = await Campaign.findById(req.params.cid).populate(['manager', 'campaignTransactions', 'associatedPlan'])
        const contract = loadContractAt(contractraw.address);
        const raisedAmount = await getRaisedAmount(contract);
        const maxAmountReached = await getMaxAmountSoFar(contract);

        const dataToSend = {
            raisedAmount,
            maxAmountReached,
            ...contractraw._doc
        }
        res.status(200).json(dataToSend)
    } catch (error) {
        console.log(error)
        res.status(500).json({ error: true, message: error.message })
    }
})

web3RouterFunding.get("/raised/:cid", async (req, res) => {
    try {
        const { address } = await Campaign.findById(req.params.cid)
        const contract = loadContractAt(address);
        const maxAmountReached = await getMaxAmountSoFar(contract);

        res.status(200).json({
            raisedAmount:maxAmountReached
        })
    } catch (error) {
        err(error)
        res.status(500).json({ error: true, message: error.message })
    }
})


web3RouterFunding.get('/', auth, async (req, res) => {
    try {
        const allContracts = await Campaign.find({}).populate({path:'manager',select:['name','email','imgUrl']}).populate({path:'associatedPlan'})
        res.status(200).json(allContracts)
    } catch (err) {
        err(err)
        res.status(500).json({ error: true, message: err.message })
    }
})

web3RouterFunding.post('/deployContract', upload.single('featuredImage'), async (req, res) => {
    try {
        const data = req.body
        const manager = await User.findById(data.userId)
        const expire = data.deadline
        const contract = await deployContract(
            data.walletAddress,
            data.password,
            data.target,
            expire,
            data.minContribution,
        )
        const featuredImageUrl = await uploadImageToCloud(req.file, contract._address, manager._id)
        const newContractModel = new Campaign({
            title: data.title,
            address: contract._address,
            target: data.target,
            deadline: expire,
            description: data.description,
            minContri: data.minContribution,
            date: new Date(),
            manager: manager._id,
            associatedPlan: data.associatedPlan,
            featuredImage: featuredImageUrl,
            pledges: data.pledges
        })
        await newContractModel.save()
        scheduleRefundCall(expire, contract._address)
        res.status(200).json({
            status: "Deployed Successfully",
        })
    } catch (error) {
        err(error)
        res.status(500).json({ error: true, message: error.message })
    }

})

web3RouterFunding.post('/postcontribution', auth, async (req, res) => {
    const incommingData = req.body;
    const user = await User.findById(req.user._id);
    const contractFound = await Campaign.findById(incommingData.cid)
    try {
        const txHash = await ContributeGasLessly(user.walletAddress, contractFound.address, incommingData.amount, incommingData.password)
        const walletBalance = await getBalance(user.walletAddress)
        const tx = new ContributionTx({
            senderId: user._id,
            receiverId: contractFound._id,
            amount: incommingData.amount,
            txHash: txHash.transactionHash,
            balance: walletBalance
        })
        await tx.save()
        const existingUser = contractFound.contributors.find(e => e.userId.toString() === user._id.toString())
        if (!existingUser) {
            const newContributor = {
                userId: user._id,
                deniedRequests: []
            }
            contractFound.contributors.push(newContributor)
            await contractFound.save()
        }
        user.contributions.push(tx._id)
        await user.save()
        res.json({
            status: "Success",
            message: "Contibuted successfully"
        })
    } catch (error) {
        err(error.message)
        res.json({
            status: 'Failed To Contribute',
            error: true,
            message: error.message
        })
    }
}) // API for contribution in a contract

module.exports = web3RouterFunding