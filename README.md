# Context
In 2016, I developed a fully functional subscription-based bot service for the popular game [agar.io](https://agar.io/). The project involved creating a bot cluster from scratch using JavaScript and Node.js, utilizing the concept of classes and prototypes. The bot cluster allowed users to control hundreds of cells (bots) within the game, giving them a tremendous advantage against other real players. The bot cluster was hosted on multiple Ubuntu servers, while a browser extension was developed as the graphical user interface (GUI) to enable users to interact with the bots.

By installing a chrome extension and authenticating with a valid subscription key, users could spawn hundreds of cells in game. By default, these cells were programmed to target the user's coordinates (x,y pos), enabling the user to consume them and grow larger. Additionally, users had the option to control the cells' movement direction by moving their mouse cursor, initiating gameplay where the cells would consume each other to grow larger and eat other cells. The main objective was to become the largest cell by strategically maneuvering the bots and consuming others while avoiding being consumed by larger cells.

The development of this project was solely driven by educational purposes and a desire to gain a deeper understanding of websockets, binary protocols, and reverse engineering. The project aimed to acquire practical knowledge while delivering an engaging and fun gameplay experience.

# Architecture version 010 #

## Definitions: ##
- `Website` - website with `Dapi`
- `Master` - Master server. All other servers/client connecting to `Master`
- `Box` - client/server with `Bots`
- `Bot` - bot connected/spawned by `Box`.
- `Customer` - user registered on website. `Customer` have `CustomerID` (integer) and - `CustomerKEY` (string 32 characters) to auth `Customer`
- `Subscription` - what customer bought
- `Task` - task for cluster. Like "feed customer `123` with 20 bots in party server `ABC123`, he have `10` minutes left". There is `TaskID`
- `Extension` - browser extension that `Customer` installs in browser. `Extension` knows `CustomerID` and `CustomerKEY`
- `Reception` - WebSocket server that waits connections from `Customer's` `Extension`
- `Wapi` - part of `Master` with HTTP API (RESTful API)
- `Wapic` - `Wapi` client
- `Dapi` - part of `Website` with HTTP API (RESTful API)

## Servers/Client ## 
`Master` - `Master` server, **IP must be hidden from end users**. All other servers/clients connects to `Master`. 
`Box` - client with `Bots`. `Box` connecting to `Master` and listens from commands. Should be launched on multiple VPSes
`Reception` - websocket server that listens for connections from `Extensions`. Its IP is public accessible and should be on same IP as website.

# WAPI # 
Part of `Master` with HTTP API (RESTful API)

## Requests ##
http://127.0.0.1:13500/?auth=WAPI_PASSWORD_HERE&cmd=count_boxes
http://127.0.0.1:13500/?auth=WAPI_PASSWORD_HERE&cmd=ping_box&id=BOX_ID_HERE

## Responses ##
JSON Format: 
Example:
```
{'status': 'success', 'a': 'b'}
{'status': 'error', 'code': 'UNSUPPORTED_METHOD', 'reason': 'Unknown method: DELETE'}
```
Always there `status` with `success` or `error`. If `error` then there is `code` and `reason`. **Never show any of this to end user!**

## General errors ##
- `UNSUPPORTED_METHOD` - Unknown method
- `URL_PARSE_FAIL` - Unable to parse URL
- `EMPTY_QUERY` - Unable to get query from URL
- `AUTH_REQUIRED` - There is no `auth` field found
- `AUTH_FAILED` - Invalid password
- `EMPTY_COMMAND` - There is no `cmd` field found
- `UNKNOWN_COMMAND` - Unknown `cmd` field value

## Commands ##
- `count_boxes` - counts connected `Boxes`
 - `count`
- `list_boxes` - list for IDs of `Boxes`
 - `list` - array of IDs
- `ping_box(box_id)` - calculates average ping of `Box`
 - `average` - number 
 - `history` - array of numbers of last pings 
 - **BOX_NOT_FOUND**

# DAPI #
Part of `Website` with HTTP API (RESTful API)

## Requests / Responses / General errors ##
Same as `WAPI`

## Commands ##
- `tick` - decrease time (default 60 sec) from all activated subscriptions.
 - No feedback needed
- `authorize_customer(id, key)` `Receptions` wants to authorize `Customer`
 - `username` - username of `Customer`
 - `subscriptions` - array of subscriptions. Empty array if none
   - `id` - number
   - `type` - `ffa` or `party`
   - `count` - number of available `Bots`
   - `time` - number of remaining seconds
   - `activated` - `true`/`false` is it activated or this is first time usage
 - **INVALID_CUSTOMER** - return this error if there is no such customer 
- `subscription_info(id)` - request subscription info
 - `owner` - ID of customer
 - `type` - `ffa` or `party`
 - `count` - number of available `Bots`
 - `remain` - number of remaining seconds
 - `activated` - `true`/`false` is it activated or this is first time usage
 - **INVALID_SUBSCRIPTION** - return error if subscription not found
- `cluster_overloaded(subscription_id, customer_id)` - we need more servers. After solve, give this subscription some free time
 - No feedback needed 
- `request_proxies(subscription_id, region, count)` - get `count` of socks
 - `list` - array of arrays of socks like `[ip, port, version]` like `[['1.2.3.4','8888','5'],['2.2.2.2','123','4']]`
- `subscription_activate(id)` - activate subscription since this is first use
 - No feedback needed
 
# Extension #
`var econ = new Extension();`

## Props ##
- `connected` - is connected to `reception`
- `initialized` - initialized by `reception`
- `hooked` - is hooked to agar.io connection
- `killed` - killed by `reception` and no more connections will be made
- `reconnect_attempt` - reconnect attempt number
- `feedback_queue` - queue of errors
- `customer_id` - `customer` id
- `customer_key` - `customer` key
- `socket` - EIO socket
- `state` - check `Extension.state`
- `engaged` - array of engaged IDs on this session
- `target` - mouse / cords / nickname / ball

## Functions ##
- `engage_subscription(id)` - engage. **Will return `false` if hook is not installed**, this mean extension was loaded after agario scripts connected to server. Fix it or ask user to connect to new server so hook can be installed on new connection.

## Events ##
Using `EventEmitter`
- `on.connect()` - connected to `reception` server
- `on.disconnect()` - disconnected from `reception` server
- `on.reconnect(attempt, delay)` - reconnecting, first attempt will be **0** with **0** delay, do not show it
- `on.cleanup()` - extension is cleaned itself after disconnect
- `on.userinfo(obj)` - userinfo received, 
 - `obj.username` username 
 - `obj.subscriptions` number of subscriptions count
- `on.notice(notice_code, kill)` - notice received. `Codes` listed below. `kill` true/false - close connection without reconnect or not
- `on.subscriptionAdded(sub)` 
 - `sub.id` number
 - `sub.count` count of bots
 - `sub.remain` seconds remaining
 - `sub.expire` expire timestamp. Ignore for unactivated
 - `sub.type` type `party` or `ffa`
 - `sub.activated` is activated `true`/`false`
- `on.versionUpgrade(version)` - upgrade version of script (load script as 'script.js?NEW_VERSION')
 - `version` number of new version
- `on.authorized` customer is authorized and ready
- `on.subscriptionEngaged(id, opt)` subscription engaged
 - `id` - ID of subscription
 - `opt.this_session` - engaged in this session or not (opened in another tab/browser/computer)
- `on.subscriptionDisengaged(id)` subscription disengaged
 - `id` - ID of subscription
- `on.subscriptionConnected(id, count)` subscription connected bots count
 - `id` - ID of subscription
 - `count` - amount of connected bots
- `on.subscriptionActivated(id)` subscription activated and expire timer started
 - `id` - ID of subscription
 

## Extension.state ##
Props:
- `target` - current target type
- `my_ball` - last my ball ID

Events:
- `on.error(msg)` - error
- `on.mousePos(x, y)` - new mouse position caught
- `on.myNewBall(ball_id)` - our new ball id
- `on.leaderBoardUpdate(arr)` - array of leaders IDs
- `on.hook(server, key)` - hooked to connection

## Packets ##
- `0` Client->Server `auth(version, customer_id, customer_key)`
- `1` Client->Server `feedback(msg)`
- `2` Server->Client `userinfo(object {username: '', subscriptions: [ check Dapi commands ]})`
- `3` Server->Client `notice(notice_code, kill)`
- `4` Server->Client `upgrade_version(new_version)`
- `5` Client->Server `engage_subscription(id, region, gamemode, key)` engage
- `7` Server->Client `engaged(id, this_session)` when engaged
- `8` Server->Client `disengaged(id)` when disengaged
- `9` Server->Client `connected(id, count)` connected bots amount update
- `10` Server->Client `activated(id)` subscription activated and expire timer started
- `11` Client->Server `leaders(arr)` send new leader board
- `12` Client->Server `new_cords(x, y)` send new position to target
- `13` Client->Server `new_ball(ball_id)` send new ball_id to target
- `14` Client->Server `new_nickname(nick)` send new nickname target

## Notice codes ##
- `0` Version mismatch, tell user to refresh page (you can ignore this since we have `upgrade_version(new_version)` packet)
- `1` Error while communicating with `Dapi` server. Tell user to try again later
- `2` Auth failed. CustomerID or CustomerKEY is incorrect.
- `3` Subscription not found
- `4` Subscription expired
- `5` Subscription type mismatch (for example user on party, but subscription for ffa)
- `6` Subscription did not received region code. Try to refresh page
- `7` Subscription did not received party key. Try to refresh page
- `8` Subscription is already in use. Check opened tabs or who you gave you password
- `9` Cluster is overloaded and unable to engage subscription. Tell user that free time will be added when cluster will be fixed.
- `10` Subscription did not received server. Try to refresh page
- `11` Subscription received wrong format of FFA key. Try to refresh page
- `12` Subscription received wrong format of party key. Try to refresh page
- `13` Subscription received wrong format server address. Try to refresh page
- `14` Task can't connect to party server. Is it closed?
- `15` Subscription time is expired while it was engaged
- `16` Failed to activate subscription on DAPI
- `17` Box crashed while task was engaged

# Misc #
Not to forget:
- If customer engages bots and then refreshes page and then engages again immediately give him timeout to protect from overload cluster
- Website should write to extension memory `customer_id`,`customer_key`
- Extension should write its version SOMEWHERE(?) into memory
- Injector should add `?version` to .js file to bypass cache. `version` will be stored SOMEWHERE(?) in extension memory.
- `Reception` check ws.state of user before send
- If cluster don't have free servers on subscription engage, then notice user and add subscription time

TODO website:
Plans should have "count" of bots, "time" remained seconds to use, "active" is it activated by master after first use
Customers should have `CustomerID`, `CustomerKEY` (randomly generated secret string)


When customer buys plan do not activate it immediately, set `active=false`

## Vulnerables ##
- Send invalid IP for FFA server
- Send invalid leaders list for FFA servers
- Send fake party server with millions of balls in it
- Send gigabytes of data to reception
