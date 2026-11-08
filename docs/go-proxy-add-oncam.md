# 给 Go 代理补一条缺失的消息（以 OnCamRecognition 为例）

> 结论先说：**上游 proto 里没有 `WebcastGroupLiveOnCamRecognitionMessage`**，
> 代理的 `generated/struct.go` 又只把「已注册 method」转成 JSON，
> 所以这条消息现在**根本不会送到我们这边**。要拿到它，必须改 proto + 重新编译代理。

依据（官方文档）：

- [douyinlive-proto README · 更新协议定义](https://github.com/jwwsjlm/douyinlive-proto#更新协议定义)
- [douyinLive docs/library.md · Protobuf 类型来源](https://github.com/jwwsjlm/douyinLive/blob/main/docs/library.md)
- [douyinLive docs/websocket-client.md · 直播业务消息](https://github.com/jwwsjlm/douyinLive/blob/main/docs/websocket-client.md)

---

## 一、消息是怎么被"认出来"的

代理收到 WS 二进制帧后做两件事：

```
帧 ──> common.method（字符串，如 "WebcastGiftMessage"）
        │
        ├─ generated/struct.go 的 newMessage 映射里**能查到** → proto.Unmarshal 成结构体 → 转 JSON 推给客户端
        └─ 查不到 → 这条消息直接丢掉（不会出现在 WS JSON 里）
```

实测印证：我们本地日志里出现过 `WebcastRoomRankMessage`、`WebcastInRoomBannerMessage` 等
（说明它们在映射表里），但**从来没有** `OnCamRecognition` —— 因为它不在映射表里。

---

## 二、需要改的三个文件（都在 `douyinlive-proto` 仓库）

| 文件 | 改什么 |
| --- | --- |
| `protobuf/new_douyin.proto` | 加消息定义（字段编号必须和线上字节一致） |
| `generated/new_douyin/new_douyin.pb.go` | `protoc` 生成，别手写 |
| `generated/struct.go` | **加 method → 结构体映射**（漏了这步等于没加） |
| `generated/messagepool.go` | 可选：加对象池，减少高频解析分配 |

### 2.1 proto 定义

字段编号来自《主播上场提醒-完整文档》第三节（手解 dump 得出的结构）：

```
body {
  field1 = 小型枚举（1/2/3，含义未定）
  field2 = repeated 每人 { field1 = uid(string), field3 = 置信度(double), field4 = 框 }
}
```

对应 proto（**框先用 bytes 收**，避免框结构猜错污染解析）：

```proto
// 加在 new_douyin.proto 里其它 Webcast_Im_* 消息附近
message Webcast_Im_GroupLiveOnCamRecognitionMessage {
  message OnCamItem {
    string uid = 1;          // 团员 uid（和团员榜 user_info.id 同一个值）
    double confidence = 3;   // 置信度，实测 0.41–0.65
    bytes box = 4;           // 人脸框，先按原始字节收
  }

  int32 category = 1;        // 小型枚举，含义未定
  repeated OnCamItem items = 2;
}
```

> ⚠️ 字段编号是这套方案唯一的风险点：编号错一个，解析出来就是垃圾（文档坑 6）。
> 上线前必须拿一段真实 dump 验证「解出来的 uid 能在团员榜里查到对应昵称」。

### 2.2 重新生成

```powershell
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
protoc --proto_path=protobuf --go_out=. --go_opt=module=github.com/jwwsjlm/douyinlive-proto protobuf/new_douyin.proto
```

### 2.3 注册映射（关键一步）

`generated/struct.go` 的 `newMessage` 里加一行，和 `WebcastGroupLiveContainerChangeMessage` 那几行同格式：

```go
// 团播「谁在麦上」的人脸识别结果
"WebcastGroupLiveOnCamRecognitionMessage": func() protoreflect.ProtoMessage {
    return &new_douyin.Webcast_Im_GroupLiveOnCamRecognitionMessage{}
},
```

### 2.4 发版与升级

```bash
# proto 仓库
git tag v0.1.4 && git push --tags

# 主仓库
go get github.com/jwwsjlm/douyinlive-proto@v0.1.4
go mod tidy
go build -o douyinLive ./cmd/main
```

把新二进制替换到部署目录（`douyinLive-linux-amd64` / `douyinLive-win-amd64.exe`），重启。

---

## 三、怎么验证代理真的转发了

重启后看我们 worker 的日志（`lib/worker/message-handler.js` 的 default 分支会打印）：

```
[65209552987] ❓ 未处理消息类型: WebcastGroupLiveOnCamRecognitionMessage
```

**看到这行就说明代理已经把它转成 JSON 推过来了**，剩下的只是我们这边解析：

```json
{
  "method": "WebcastGroupLiveOnCamRecognitionMessage",
  "category": 1,
  "items": [ { "uid": "2203876772819496", "confidence": 0.62, "box": "..." } ]
}
```

然后在 `message-handler.js` 里接上（和进度条通道同一个出口）：

```js
case 'WebcastGroupLiveOnCamRecognitionMessage': {
  const frames = (data.items || [])
    .map((it) => ({ uid: String(it.uid || ''), conf: Number(it.confidence) || 0 }))
    .filter((f) => f.uid);
  if (frames.length) {
    require('../upstage/ingest').feedFrames(room.roomId, frames, 'face');
  }
  break;
}
```

---

## 四、不改 Go 的替代方案（对比）

| 方案 | 要不要动 Go | 能不能拿到人脸 | 备注 |
| --- | --- | --- | --- |
| 改 proto + 重编译（本文） | 要 | ✅ | 一次到位，之后所有房间都能用 |
| 复用服务器上的 `watch_oncam.py` | 不要 | ✅ | 那套脚本已经在解 dump，只需要加几行 POST 到 `/api/upstage/frames` |
| 只用进度条通道 | 不要 | ❌（只有公会赛/挑战位） | 零改动，但覆盖不全 |

**建议**：短期用 Python 转发把链路跑通（今天就能验证业务），
同时按本文改 proto —— 改完之后代理自己就能输出人脸帧，不再依赖旁路 dump。
