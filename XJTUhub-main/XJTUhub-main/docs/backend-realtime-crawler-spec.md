# 云小慧后端实时查询与多学校爬取实施规范

更新时间：2026-04-18
适用范围：当前前端仓库 yunxiaohui-main 对接的后端服务

## 1. 目标

本规范用于指导后端完成以下工作：

1. 保持当前前端可用，不破坏已有接口。
2. 把现有前端中的本地演示数据能力（考勤、DDL）改为后端实时查询。
3. 新增可扩展的学校适配层，支持接入你自己的学校教务系统爬取。
4. 统一接口返回结构、错误码、鉴权行为，降低前端改动成本。

## 2. 当前前端依赖的接口与行为（必须兼容）

当前前端通过统一请求层调用如下接口：

1. POST /login
2. GET /login-init
3. POST /login-verify
4. GET /login-code
5. GET /courses
6. GET /scores
7. GET /raw-scores

### 2.1 统一返回结构

前端请求层按以下格式处理响应：

```json
{
  "code": 0,
  "msg": "ok",
  "data": {}
}
```

约定：

1. code = 0：成功。
2. code = -1：业务失败，前端 toast 显示 msg。
3. code = 403：登录失效，前端强制跳登录。
4. 其他 code：前端统一显示“服务开小差啦”。

### 2.2 鉴权头约定

当前前端把 token 放在请求头字段 token：

```http
token: <cookie-or-token>
```

后端应继续支持该字段，避免前端大改。

## 3. 当前前端实际字段契约（后端必须返回）

## 3.1 登录

### POST /login

请求：

```json
{
  "stuId": "学号",
  "password": "密码"
}
```

成功响应（关键字段）：

```json
{
  "code": 0,
  "data": {
    "cookie": "会话令牌"
  }
}
```

说明：前端会把 data.cookie 存到本地 token。

### GET /login-init

用于验证码登录初始化，至少返回：

```json
{
  "code": 0,
  "data": {
    "cookie": "初始化会话",
    "formData": {}
  }
}
```

### GET /login-code

前端通过 /login-code?cookie=xxx 下载验证码图片。

### POST /login-verify

请求：

```json
{
  "stuId": "学号",
  "password": "密码",
  "verifyCode": "验证码",
  "cookie": "初始化cookie",
  "formData": "JSON字符串"
}
```

成功响应仍需包含 data.cookie。

## 3.2 课表

### GET /courses

返回 data 为课程数组，每项至少包含：

```json
{
  "name": "课程名",
  "address": "上课地点",
  "week": 1,
  "weeks": [1, 2, 3],
  "section": 1,
  "sectionCount": 2,
  "rawWeeks": "1-16周",
  "rawSection": "1-2节",
  "teacher": "教师",
  "credit": "学分",
  "category": "课程类型",
  "method": "考查方式"
}
```

关键字段是 week/weeks/section/sectionCount/name，缺失会直接影响渲染。

## 3.3 成绩

### GET /scores

返回 data 为学期数组：

```json
[
  {
    "termName": "2025-2026-1",
    "scoreList": [
      {
        "name": "高等数学",
        "score": 91
      }
    ]
  }
]
```

### GET /raw-scores

返回 data 结构同学期数组，但 scoreList 明细字段为：

```json
{
  "name": "高等数学",
  "normalScore": 90,
  "midtermScore": 88,
  "finalScore": 92,
  "complexScore": 91
}
```

## 4. 需要新增的实时接口（前端当前未接后端）

当前考勤和 DDL 页面使用本地 mock，建议后端新增以下接口并保持字段与页面一致。

### 4.1 考勤实时查询

1. GET /attendance

响应示例：

```json
{
  "code": 0,
  "data": [
    {
      "courseName": "高等数学",
      "teacher": "王老师",
      "absences": 0,
      "late": 1,
      "leave": 0,
      "risk": "normal"
    }
  ]
}
```

risk 建议枚举：normal、warning、danger。

### 4.2 DDL 实时查询与更新

1. GET /ddl
2. PATCH /ddl/:id

GET /ddl 返回：

```json
{
  "code": 0,
  "data": [
    {
      "id": "ddl-1",
      "title": "软件工程立项报告提交",
      "course": "软件工程",
      "deadline": "2026-04-20 23:59",
      "done": false
    }
  ]
}
```

PATCH /ddl/:id 请求：

```json
{
  "done": true
}
```

## 5. 多学校爬取后端架构（推荐）

建议采用 provider 插件架构，不要在控制器里写死学校逻辑。

### 5.1 核心抽象

定义 SchoolProvider 接口：

1. initLogin()
2. getLoginCaptcha(initState)
3. login(credentials)
4. fetchCourses(session)
5. fetchScores(session)
6. fetchRawScores(session)
7. fetchAttendance(session)
8. fetchDDL(session)

每个学校一个实现：

1. BaiyunProvider
2. MySchoolProvider
3. 未来新增学校 Provider

通过 schoolCode 路由到不同 provider。

### 5.2 推荐目录

```text
src/
  modules/
    auth/
      auth.controller.ts
      auth.service.ts
    edu/
      edu.controller.ts
      edu.service.ts
  providers/
    school/
      provider.interface.ts
      provider.factory.ts
      baiyun.provider.ts
      myschool.provider.ts
  core/
    session/
    http/
    parser/
```

## 6. 多学校参数与兼容策略

## 6.1 新增 schoolCode 参数

建议在登录相关接口增加 schoolCode：

```json
{
  "schoolCode": "myschool",
  "stuId": "...",
  "password": "..."
}
```

## 6.2 兼容当前前端

为避免前端立即改动，后端可先做兼容：

1. 如果未传 schoolCode，则默认 schoolCode=baiyun。
2. 令牌中记录 schoolCode，后续查询自动路由到对应 provider。

## 7. 实时查询策略

建议模式：请求触发实时拉取 + 短缓存兜底。

1. 先查缓存（例如 30-120 秒）。
2. 缓存命中直接返回，异步刷新。
3. 缓存未命中或强制刷新时实时抓取。
4. 抓取失败可回退到最近一次成功快照，并标记 dataSource=cache。

可选：支持前端 refresh=1 参数强制实时。

## 8. 错误码建议

在保持 0/-1/403 兼容的前提下扩展细分码：

1. 0：成功
2. -1：业务失败（兜底）
3. 40101：账号密码错误
4. 40102：验证码错误
5. 40103：会话过期
6. 403：登录失效（前端已依赖）
7. 42901：请求过快/触发风控
8. 50001：教务系统结构变更解析失败
9. 50002：上游教务系统不可用

对前端兼容策略：细分码可以存在，但 code=403 必须保留其语义。

## 9. 安全与合规

1. 学生账号密码不落库明文。
2. session/cookie 加密存储，设置过期。
3. 接口全链路 HTTPS。
4. 日志脱敏（学号、cookie、验证码）。
5. 遵守目标学校系统使用条款与法律边界。

## 10. 观测与运维

必须建设以下可观测项：

1. 每学校登录成功率。
2. 每学校抓取成功率与耗时。
3. 上游状态码分布。
4. 解析失败告警（DOM 结构变化）。
5. 账号风控告警（短时失败次数）。

## 11. 后端开发任务拆解

## 阶段 A：兼容当前前端

1. 校验并固化已有 7 个接口契约。
2. 统一返回结构 code/msg/data。
3. 统一 token 解析与 403 行为。

## 阶段 B：新增实时模块

1. 新增 /attendance、/ddl、/ddl/:id。
2. 接入真实教务抓取逻辑或聚合来源。
3. 保持字段与前端页面一致。

## 阶段 C：多学校 provider

1. 抽象 provider 接口。
2. 落地 myschool provider。
3. schoolCode 路由和默认兼容。
4. 回归测试：baiyun 与 myschool 并行可用。

## 阶段 D：联调与压测

1. 前后端联调全链路登录 + 查询。
2. 高峰并发下缓存与风控验证。
3. 失败场景演练（验证码错、会话过期、上游宕机）。

## 12. 联调验收清单

1. 登录、验证码登录均可成功。
2. /courses、/scores、/raw-scores 字段完整。
3. /attendance、/ddl 实时返回且字段不变。
4. token 过期时返回 403，前端可自动回登录。
5. 切换 schoolCode 时返回对应学校数据。
6. 上游异常时返回可读 msg，不出现空白页。

## 13. 对前端最小改动建议（可选）

如果后端按本规范兼容，前端可以暂时不改。若要显式切学校，仅需后续追加：

1. 登录页增加 schoolCode 选择。
2. /login 与 /login-verify 传 schoolCode。
3. 其余页面无需改字段，只沿用当前接口。

---

如后端采用本规范实施，可先以不改前端为第一目标完成上线，再逐步增加学校切换 UI 与更多教务模块。