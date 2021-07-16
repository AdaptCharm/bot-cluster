Subscription.subscriptions = {};

function Subscription(uid, opt) {
    this.id         = opt.id;
    this.owner_uid  = uid;
    this.type       = opt.type;
    this.count      = opt.count;
    this.nickname   = opt.nickname;
    this.remain     = opt.remain;
    this.activated  = opt.activated;
    this.expire     = opt.remain*1000 + (+new Date);
    this.engaged_by = null;
    this.task       = null;
}

module.exports = Subscription;