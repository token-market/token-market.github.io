/*jshint esversion: 6*/
const c_Mainnet=0;
const c_Testnet=1;
const c_envs = [
    {
        chainId: 1,
        name: "Mainnet",
        url: "https://mainnet.nebulas.io",
        contract:"n1oqCzHFuy5UyGYiUt6jZwr5zYkPasG7ME3",
        creator:"n1aJRdzKapRuxV21YKmjLEXng4e9AJz1DLN",
        explorer:"https://explorer.nebulas.io/#/",
        callback:"https://pay.nebulas.io/api/mainnet/pay",
    },
    {
        chainId: 1001, 
        name: "Testnet", 
        url: "https://testnet.nebulas.io", 
        contract:"n1jcYzHLokpykGU9btr74XZCxtQnvBMsa6K",
        creator:"n1K2nSbJWiKVnHCAi7PFEjGef7iDQVFsTs8",
        explorer:"https://explorer.nebulas.io/#/testnet/",
        callback:"https://pay.nebulas.io/api/pay",
    }
];

function getNet() {
    let queryNet = (getQueryVariable("net")||"Testnet").toLowerCase();
    let net = 0;
    let len = c_envs.length;
    for (; net < len; ++net)
        if(c_envs[net].name.toLowerCase() == queryNet)
            break;

    return net < len ? net : 0;
}

function getEnv(net) {
    if(net === undefined)
        net = getNet();
    return c_envs[net];
}
