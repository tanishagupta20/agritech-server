require('dotenv').config()
const web3 = require('./web3')
const ABI = require("./compile.js").compiledABI
const bytecode = require("./compile.js").compiledByteCode
const {info}=require("../utils/logger");

// info(ABI)
// const managerAcc = process.env.BACKEND_COINBASE_WALLET_ADDRESS
// info(managerAcc)
const contract = new web3.eth.Contract(ABI);

async function deployContract(account,password, target,deadline,minContribution){
    const unlocked = await web3.eth.personal.unlockAccount(account,password)
    if(unlocked){
        const preDeploy = await contract.deploy({ 
            data: bytecode,
            arguments:[account,target,deadline,minContribution]
        })
        info("preDeployed -->",preDeploy)

        const estimateGasFee = await preDeploy.estimateGas()*2
        
        info("Predicted fee -->",estimateGasFee)
        const deployedContract = await preDeploy.send({ from: '0x04c3a9591730b0fb78f18a258520d8f23431f06c', gas:estimateGasFee })
        info(deployedContract._address)
        return deployedContract
    }else{
        return 'Incorrect Password (Account not Unlocked)'
    }
}


module.exports = deployContract