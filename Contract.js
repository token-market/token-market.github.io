/*jshint esversion: 6*/
/*jshint node:true */

'use strict';

const version="1.0.0";
const unit_nas=new BigNumber(1000000000000000000);


var TokenList = function(obj) {
    if (typeof obj === "string") {
        this.hash_list = JSON.parse(obj);
    }
    else
        this.hash_list=[];
};

TokenList.prototype = {
    toString: function () {
        return JSON.stringify(this.hash_list);
    },
    addToken:function(hash){
        for(var i=0;i<this.hash_list.length;++i)
            if(hash == this.hash_list[i])
                return;
        this.hash_list.push(hash);
    },
    removeToken:function(hash){
        for(var i=0;i<this.hash_list.length;++i) {
            if(hash == this.hash_list[i]) {
                this.hash_list.splice(i,1);
                return;
            }
        }
    }
};

var Token = function(obj) {
    if (typeof obj === "string") {
        obj = JSON.parse(obj);
    }
    if (typeof obj === "object") {
        this.ownerAddr = obj.ownerAddr;     //发起人钱包地址
        this.hash = obj.hash;               //发起交易的hash
        this.title = obj.title;             //项目标题
        this.contract = obj.contract;       //代币合约地址
        this.symbol = obj.symbol;           //代币符号
        this.decimals = obj.decimals;       //代币小数位数
        this.price = obj.price;             //代币价格
        this.total = obj.total;             //总共额度
        this.text = obj.text;               //活动介绍(html格式)
        this.beginBlock = obj.beginBlock;   //开始报名区块号
        this.endBlock = obj.endBlock;       //结束报名区块号
        this.locked = obj.locked;           //是否锁定，锁定后不能竞价，不能领取奖励
        this.orders = obj.orders||[];       //竞投的历史记录
        this.state = obj.state||0;          //状态，0=active, 1=completed, 2=cancel
        this.sold = obj.sold||0;            //已售额度
    }
};
Token.active = 0;
Token.complete = 1;
Token.cancel = 2;

Token.prototype = {
    toString: function () {
        return JSON.stringify(this);
    },
    isActive:function(){
        let height = Blockchain.block.height;
        return height>=this.beginBlock&&height<this.endBlock;
    }
};


var TokenMarketContract = function () {
    LocalContractStorage.defineProperties(this, {
        _name: null,
        _admin: null,
    });

    LocalContractStorage.defineMapProperties(this, {
        _tokens: {
            parse: function (str) {
                return new Token(str);
            },
            stringify: function (obj) {
                return obj.toString();
            }
        },
        _tokenList: {
            parse: function (str) {
                return new TokenList(str);
            },
            stringify: function (obj) {
                return obj.toString();
            }
        },
    });
};

TokenMarketContract.prototype = {
    //智能合约初始化函数，只会在部署的时候执行一次
    init: function () {
        this._name = "Token Market";
        this._admin = Blockchain.transaction.from;
    },

    name: function () {
        return this._name;
    },

    version:function() {
        return version;
    },

    //设置管理员
    setAdmin:function (addr) {
        if(Blockchain.verifyAddress(addr)!==87) {
            throw new Error("addr is not a user address!");
        }
        
        var from = Blockchain.transaction.from;
        if(from != this._admin) {
            throw new Error("You are not the manager!");
        }

        this._admin=addr;
    },

    //添加代币
    addToken:function (ownerAddr, title, contract, symbol, decimals, price, total, text, beginBlock, endBlock) {
        if(Blockchain.verifyAddress(ownerAddr)!==87) {
            throw new Error("ownerAddr is not a user address!");
        }
        if(Blockchain.verifyAddress(contract) !== 88) {
            throw new Error("contract is not a contract address!");
        }
        var from = Blockchain.transaction.from;
        if(this._admin !== from) {
            throw new Error("You are not a admin!");
        }

        var hash = Blockchain.transaction.hash;
        this._tokens.set(hash,new Token({
            ownerAddr:ownerAddr,
            hash:hash,
            title:title,
            contract:contract,
            symbol:symbol,
            decimals:parseInt(decimals),
            price:price,
            total:total,
            text:text,
            beginBlock:parseInt(beginBlock),
            endBlock:parseInt(endBlock)
        }));

        this._addToTokenList(0, hash);
        return this._tokenList.get(0);
    },

    //完成代币售卖，并给买家发放代币
    complete:function(hash) {
        var token = this._tokens.get(hash);
        if(!token) {
            throw new Error("no token matched!");
        }

        if(token.isActive()) {
            throw new Error("has not stopped!");
        }

        var from = Blockchain.transaction.from;
        if(token.ownerAddr !== from && from !== this._admin) {
            throw new Error("not owner address!");
        }

        if(token.state !== 0) {
            throw new Error("the token has be distribute.");
        }

        this._removeFromTokenList(0, hash);
        token.state = 1;
        this._tokens.set(hash,token);
        this._addToTokenList(1, hash);

        var result = false;
        var tokenContract = new Blockchain.Contract(token.contract);
        for(let i=0; i<token.orders.length; ++i) {
            let order = token.orders[i];
            tokenContract.call("transfer",order.addr,BigNumber(order.number).shiftedBy(order.decimals));
        }
        return "ok";
    },

    //取消代币，并返还买家的NAS
    cancelToken:function(hash) {
        var token = this._tokens.get(hash);
        if(!token) {
            throw new Error("no token matched!");
        }

        if(token.state !== 0) {
            throw new Error("the token has be distribute.");
        }

        var from = Blockchain.transaction.from;
        if(token.ownerAddr !== from && from !== this._admin) {
            throw new Error("not owner address!");
        }

        this._removeFromTokenList(0, hash);
        token.state = 2;
        this._tokens.set(hash,token);
        this._addToTokenList(2, hash);

        //退还NAS
        for(let i=0; i<token.orders.length; ++i) {
            let order = token.orders[i];
            this._sendNas(order.addr, unit_nas.times(order.price).times(order.number));
        }
        return "ok";
    },

    //删除已结束的活动
    removeToken:function (hash) {
        var from = Blockchain.transaction.from;
        var token = this._tokens.get(hash);
        if(!token) {
            throw new Error("Can't find token!");
        }
        
        if(from != token.ownerAddr && this._admin != from) {
            throw new Error("You have not permission!");
        }

        if(token.state !== 1)
            throw new Error("invalid token state!");

        this._removeFromTokenList(1, hash);
        token.state = 2;
        this._tokens.set(hash,token);
        this._addToTokenList(2, hash);
    },

    //上传Token数据，用于合约升级时迁移数据
    //如果是单条数据，则添加到最后，如果是一个队列，则替换原有竞投数据
    uploadToken:function(hash,str){
        var from = Blockchain.transaction.from;
        if(from !== this._admin) {
            throw new Error("not admin address!")
        }
        var token = this._tokens.get(hash);
        if(!token) {
            throw new Error("no token matched!");
        }
        var order = JSON.parse(str);
        if(Object.prototype.toString.call(order)=='[object Array]') {
            token.orders=order;
        }
        else {
            token.orders.push(order);
        }

        this._tokens.set(hash,token);
    },

    _sendNas:function(to,nas) {
        if(nas.gt(0)) {
            var result = Blockchain.transfer(to, nas);
            console.log("transfer result:", result);
            if(result) {
                Event.Trigger("transfer", {
                    Transfer: {
                        from: Blockchain.transaction.to,
                        to: to,
                        value: nas
                    }
                });
            }
            else {
                throw new Error("return nas fails, transfer result:" + JSON.stringify(result));            
            }
        }
    },

    _sendToken:function(contract, to, value) {
        if(value.gt(0)) {
            let smartContract = new Blockchain.Contract(contract);
            smartContract.call("transfer",to,value);
        }
    },

    //设置代币介绍内容
    setTitle:function(hash, newTitle) {
        var token = this._tokens.get(hash);
        if(!token) {
            throw new Error("no token matched!");
        }
        var from = Blockchain.transaction.from;
        if(token.ownerAddr !== from && from !== this._admin) {
            throw new Error("not owner address!")
        }
        token.title = newTitle;
        this._tokens.set(hash,token);
    },

    //设置代币介绍内容
    setText:function(hash, newText) {
        var token = this._tokens.get(hash);
        if(!token) {
            throw new Error("no token matched!");
        }
        var from = Blockchain.transaction.from;
        if(token.ownerAddr !== from && from !== this._admin) {
            throw new Error("not owner address!")
        }
        token.text = newText;
        this._tokens.set(hash,token);
    },

    //设置代币价格
    setPrice:function(hash, newPrice) {
        var token = this._tokens.get(hash);
        if(!token) {
            throw new Error("no token matched!");
        }
        var from = Blockchain.transaction.from;
        if(token.ownerAddr !== from && from !== this._admin) {
            throw new Error("not owner address!")
        }
        token.price = newPrice;
        this._tokens.set(hash,token);
    },

    //设置代币价格
    setContract:function(hash, newContract) {
        var token = this._tokens.get(hash);
        if(!token) {
            throw new Error("no token matched!");
        }
        var from = Blockchain.transaction.from;
        if(token.ownerAddr !== from && from !== this._admin) {
            throw new Error("not owner address!")
        }
        token.contract = newContract;
        this._tokens.set(hash,token);
    },

    //设置代币价格
    setSymbol:function(hash, newSymbol) {
        var token = this._tokens.get(hash);
        if(!token) {
            throw new Error("no token matched!");
        }
        var from = Blockchain.transaction.from;
        if(token.ownerAddr !== from && from !== this._admin) {
            throw new Error("not owner address!")
        }
        token.symbol = newSymbol;
        this._tokens.set(hash,token);
    },

    //设置代币价格
    setDecimals:function(hash, newDecimals) {
        var token = this._tokens.get(hash);
        if(!token) {
            throw new Error("no token matched!");
        }
        var from = Blockchain.transaction.from;
        if(token.ownerAddr !== from && from !== this._admin) {
            throw new Error("not owner address!")
        }
        token.decimals = newDecimals;
        this._tokens.set(hash,token);
    },

    //设置代币价格
    setTotal:function(hash, newTotal) {
        var token = this._tokens.get(hash);
        if(!token) {
            throw new Error("no token matched!");
        }
        var from = Blockchain.transaction.from;
        if(token.ownerAddr !== from && from !== this._admin) {
            throw new Error("not owner address!")
        }
        token.total = newTotal;
        this._tokens.set(hash,token);
    },

    //设置开始区块
    setBeginBlock:function(hash, beginBlock) {
        var token = this._tokens.get(hash);
        if(!token) {
            throw new Error("no token matched!");
        }
        var from = Blockchain.transaction.from;
        if(token.ownerAddr !== from && from !== this._admin) {
            throw new Error("not owner address!");
        }
        token.beginBlock = beginBlock;
        this._tokens.set(hash,token);
    },

    //设置结束区块
    setEndBlock:function(hash, endBlock) {
        var token = this._tokens.get(hash);
        if(!token) {
            throw new Error("no token matched!");
        }
        var from = Blockchain.transaction.from;
        if(token.ownerAddr !== from && from !== this._admin) {
            throw new Error("not owner address!");
        }
        token.endBlock = endBlock;
        this._tokens.set(hash,token);
    },

    //冻结活动
    lock:function(hash,locked) {
        var token = this._tokens.get(hash);
        if(!token) {
            throw new Error("no token matched!");
        }
        var from = Blockchain.transaction.from;
        if(token.ownerAddr !== from && from !== this._admin) {
            throw new Error("not owner address!");
        }
        token.locked = locked;
        this._tokens.set(hash,token);
    },

    accept:function(){
        Event.Trigger("transfer", {
            Transfer: {
                from: Blockchain.transaction.from,
                to: Blockchain.transaction.to,
                value: Blockchain.transaction.value,
            }
        });
    },

    //管理者领取Nas, 误充Nas可以用该接口提现
    takeNasByAdmin:function(value) {
        var from = Blockchain.transaction.from;
        if(this._admin !== from) {
            throw new Error("not admin address!");
        }

        this._sendNas(from, new BigNumber(value));
        return "ok";
    },


    //管理者领取代币, 误充代币可以用该接口提现
    takeTokenByAdmin:function(contract,value) {
        if(Blockchain.verifyAddress(contract) !== 88) {
            throw new Error("contract is not a contract address!");
        }

        var from = Blockchain.transaction.from;
        if(this._admin !== from) {
            throw new Error("not admin address!");
        }

        this._sendToken(contract,from, new BigNumber(value));
        return "ok";
    },

    // 查询代币列表
    _getTokenList: function (state) {
        return this._tokenList.get(state) || new TokenList();
    },

    // 向代币列表添加代币hash
    _addToTokenList: function (state,hash) {
        let list = this._getTokenList(state);
        list.addToken(hash);
        this._tokenList.set(state, list);
    },

    // 从代币列表移除代币hash
    _removeFromTokenList: function (state,hash) {
        let list = this._getTokenList(state);
        list.removeToken(hash);
        this._tokenList.set(state, list);
    },

    // 查询代币信息
    getTokenInfo:function(hash) {
        return this._tokens.get(hash);
    },

    // 查询一批代币信息
    getTokenInfos: function (state, from, number) {
        if(state >= 3)
            throw new Error("invalid state!");

        let result = [];
        let list = this._getTokenList(state);
        let i = from;
        for (; i < from + number&&i<list.length; ++i) {
            result.push(this._tokens.get(list[i]));
        }
            
        return {
            state:state,
            total:list.length,
            from:from,
            result:result
        };
    },


    // 查询一批代币列表(倒序)
    getTokenInfosInReverse: function (state, from, number) {
        let result = [];
        let list = this._getTokenList(state).hash_list;
        let first = list.length-from-1;
        let i=first;
        for (;i > first - number && i >= 0; --i) {
            result.push(this._tokens.get(list[i]));
        }
            
        return {
            state:state,
            total:list.length,
            from:from,
            result:result
        };
    },

    //购买
    buy: function(hash) {
        var token = this._tokens.get(hash);
        if(!token) {
            throw new Error("no token matched!");
        }

        if(!token.isActive()) {
            throw new Error("not active");
        }

        if(token.locked) {
            throw new Error("is locked!");
        }

        if(this.sold >= this.total) {
            throw new Error("sold out!");
        }

        let addr = Blockchain.transaction.from;
        let nasInWei = new BigNumber(Blockchain.transaction.value);
        let time = Blockchain.transaction.timestamp;

        let number = nasInWei.dividedToIntegerBy(unit_nas.times(token.price));

        if(this.total > 0 && number > this.total - this.sold)
            number = this.total - this.sold;

        var leftNas = nasInWei.sub(number.times(unit_nas.times(token.price)));
        if(nasInWei.lt(1)) {
            throw new Error("nas is not enought");
        }
        
        this.sold += number;
        token.orders.push({
            hash:Blockchain.transaction.hash,
            addr:addr,
            nasInWei:nasInWei.toString(10),
            price:token.price,
            number:number,
            time:time
        });

        this._sendNas(addr, leftNas);
        this._tokens.set(hash,token);
        return "ok";
    },

    //取消订单
    cancelBuy:function(hash,orderId){
        var token = this._tokens.get(hash);
        if(!token) {
            throw new Error("no token matched!");
        }

        if(!token.isActive()) {
            throw new Error("not active");
        }

        if(token.locked) {
            throw new Error("is locked!");
        }

        if(orderId>=token.orders.length) {
            throw new Error("invalid orderId!");
        }

        let order = token.orders[orderId];

        if(order.addr !== Blockchain.transaction.from) {
            throw new Error("sender is not order's owner!");
        }

        if(this.sold < order.number) {
            throw new Error("no more token to cancel!");
        }

        var nas = unit_nas.times(order.price).times(order.number);
        
        this.sold -= order.number;
        token.orders.splice(orderId,1);

        this._sendNas(order.addr, nas);
        this._tokens.set(hash,token);
        return "ok";
    }
};

module.exports = TokenMarketContract;