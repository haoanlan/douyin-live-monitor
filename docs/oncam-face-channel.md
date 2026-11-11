# 人脸通道（OnCamRecognition）落地记录 · 2026-11-11

> 目标：拿到团播「谁在麦上」的官方人脸识别消息，用于「主播上场提醒」。
> 结论：**已经打通并在跑**，uid 也确认是稳定的（下面有实测证据）；
> 剩下的是业务侧：规则怎么配（按人 + 按房间）。

---

## 一、之前为什么拿不到

`douyinlive-proto` 里**没有** `WebcastGroupLiveOnCamRecognitionMessage` 的定义，
Go 代理的 `generated.GetMessageInstance(method)` 查不到就直接 `return` 丢掉。

## 二、这次怎么解决的（没有改 proto）

改了代理的一条分支：**未注册的 method 不再一律丢弃，命中白名单时把原始 payload 以
base64 转给客户端**，由业务侧自己解。

- 补丁：`patches/proxy-forward-raw-oncam.patch`（只动 `internal/server/room_session.go`）
- 白名单：`WebcastGroupLiveOnCamRecognitionMessage`，以及任何 method 含 `OnCam` 的兜底
- 输出形状：普通事件 JSON + `payloadB64` 字段
- 业务侧解析：`lib/upstage/oncam.js`（手写 protobuf wire 解析，不依赖 proto 生成代码）

好处：对面以后加字段/改结构，我们最多是少解析一个字段，不会因为 proto 编错而整条消息变垃圾。

## 三、实测报文结构（房间 65209552987，2026-11-11 抓了 6 个样本）

```
root
  field 1 = header（method / msgId，忽略）
  field 2 = body
            field 1 = category    varint（样本都是 1）
            field 2 = repeated person
                        field 1 = uid        字符串（19 位也不丢精度）
                        field 3 = confidence double（实测 0.42–0.50）
                        field 4 = box        4 个 varint：左/上/宽/高
            field 4 = timestamp  字符串毫秒时间戳（如 "1794408686000"）
```

两种帧长：

| 长度 | 内容 | 含义 |
| --- | --- | --- |
| 130B | category + 1 个 person + timestamp | 识别到人（uid + 置信度 + 框） |
| 84B | category + timestamp | 这一刻没人在镜头里（正常空帧） |

## 四、uid 到底会不会变？—— 实测：不会，是我们之前丢了精度

同一时刻两处对照：

```
人脸消息：uid = 7450866781424895034
团员榜 ：id_str = 7450866781424895034（Vv负十六）    ← 一致
团员榜 ：id     = 7450866781424895000（number，末位被舍入）
```

19 位 id 超过 JS 的 2^53，用 `Number` 解析就会变。旧的 `String(info.id)` 拿到的正是被舍入的值，
所以看起来"uid 会变"。修复：`lib/upstage/uid.js` 的 `asUid()` 优先 `id_str`。

另外：我们 11-08 存的 `西柠 uid=67232674905`，今天团员榜返回的仍是 `67232674905`。

**结论：uid 可以当人的主键**，不需要按昵称匹配。

## 五、现在的状态

- 代理二进制已替换为打过补丁的版本（旧版备份 `douyinLive-win-amd64.exe.bak`）
- 代理日志：`转发未注册消息（原始 payload）… method=WebcastGroupLiveOnCamRecognitionMessage payload_len=130`
- 后端日志：`[65209552987] 👤 人脸通道已接入：uid=7450866781424895034 conf=0.4426`
- 数据落库：`upstage_seen` 出现 `{uid: 7450866781424895034, source: 'face'}`

## 六、怎么重打包（复现步骤）

```bash
# 1) 源码（走 ssh 443，https 到 github 不通）
git clone ssh://git@ssh.github.com:443/jwwsjlm/douyinLive
git clone ssh://git@ssh.github.com:443/jwwsjlm/douyinlive-proto

# 2) 打补丁
cd douyinLive && git apply .../new_douyinlive/patches/proxy-forward-raw-oncam.patch

# 3) 编译（Go 1.27.4 便携版；GOPROXY 用 goproxy.cn）
GOPROXY=https://goproxy.cn,direct GOFLAGS=-mod=mod go build -trimpath -o douyinLive-oncam-amd64.exe ./cmd/main

# 4) 替换并重启（先备份旧二进制）
```

## 七、还要做的（业务侧）

1. 通知规则里加「关注的人」条件（事件 = 主播上场），和现有「直播间」多选共存 → 满足「人 + 房间」
2. 名单按账号隔离（`owner`），和通知渠道/规则一致
3. 空帧不触发；同一人连续帧只算一次（引擎已有 CONF_MIN / NEED_HITS 逻辑）

> 注意：代理这层是「未注册 method 白名单转发」，属于临时但稳定的方案。
> 如果以后官方 proto 补齐了，可以把白名单去掉，直接用 proto 解析。
