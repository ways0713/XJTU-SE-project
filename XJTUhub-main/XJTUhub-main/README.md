# XJTUhub

西安交通大学校园学习助手微信小程序（当前仓库为前端小程序工程）。

项目聚焦于同学常用的教务与学习场景，提供登录、课表、成绩、资料浏览、DDL 提醒、考勤查看等能力，并支持浅色主题与自定义 TabBar。

## 主要功能

- 登录能力
	- 普通登录：学号 + 密码
	- 验证码登录：支持初始化登录态、拉取验证码并提交登录
	- 登录态管理：未登录自动跳转登录，登录后支持回跳
- 课表
	- 周视图课表
	- 当前周自动计算
	- 课程详情弹窗（教师、地点、周次、节次、学分等）
	- 本地缓存与手动更新
- 成绩
	- 按学期切换成绩
	- 成绩详情（有效成绩 + 原始成绩明细）
	- 本地缓存与手动更新
- 资料广场（首页）
	- 分类筛选（课件/笔记/试题）
	- 关键词搜索
	- 分页加载
	- 接口不可用时自动回退到本地示例数据
- 功能聚合页
	- 快速进入：成绩、考勤、DDL
- 考勤与 DDL
	- 当前版本使用本地示例数据与本地缓存
	- 支持 DDL 勾选完成状态
- 个人中心
	- 登录状态展示
	- 常用功能快捷入口
	- 退出登录

## 技术栈

- 微信小程序原生框架
- Vant Weapp（已集成到项目）
- ColorUI（样式与图标）
- 统一请求封装（token 鉴权 + 错误码处理 + 登录态跳转）

## 目录概览

```text
api/                 接口定义
custom-tab-bar/      自定义 TabBar
docs/                后端对接规范等文档
pages/               页面代码
	index/             首页（资料广场）
	login/             普通登录
	login-verify/      验证码登录
	course/            课表
	score/             成绩
	function/          功能聚合
	attendance/        考勤（当前为本地示例数据）
	ddl/               DDL（当前为本地示例数据）
	mine/              个人中心
utils/               工具与请求封装
config.js            环境与接口地址配置
app.json             全局页面与 TabBar 配置
```

## 快速开始

### 1. 环境准备

- 安装 Node.js（建议 LTS）
- 安装微信开发者工具
- 准备可用后端服务（本地或远程）

### 2. 安装依赖

```bash
npm install
```

### 3. 导入项目

使用微信开发者工具打开本项目根目录。

### 4. 构建 npm

在微信开发者工具中执行「工具 -> 构建 npm」，确保 Vant Weapp 组件可用。

### 5. 配置接口地址

修改 `config.js` 中的环境与地址：

```js
let env = "develop"

export default {
	env,
	baseUrl: {
		develop: 'http://localhost:3000',
		production: 'http://api.xxx.com',
	}
}
```

说明：发布环境下会自动保护性切到 production，避免误用开发地址。

## 登录与测试账号

登录页默认填充测试账号：

- stuId: test
- password: 123456

是否可直接登录取决于你当前接入的后端是否提供对应测试账户。

## 当前接口清单

前端已对接接口（见 `api/main.js`）：

- POST /login
- GET /login-init
- POST /login-verify
- GET /courses
- GET /scores
- GET /raw-scores
- GET /resources

统一响应结构：

```json
{
	"code": 0,
	"msg": "ok",
	"data": {}
}
```

错误码约定：

- code = 0：成功
- code = -1：业务失败（前端 toast 显示 msg）
- code = 403：登录失效（前端跳转登录）

## 数据来源说明

- 课表、成绩、资料：优先走后端接口
- 考勤、DDL：当前为本地示例数据（后续可对接实时接口）
- 首页资料：请求超时会自动回退示例数据，保证页面可用

## 相关文档

- 后端实时化与多学校爬取规范：`docs/backend-realtime-crawler-spec.md`
- 配套文章：
	- [1.项目环境搭建](articles/1.项目环境搭建.md)
	- [2.小程序登录功能开发](articles/2.小程序登录功能开发.md)
	- [3.封装请求函数](articles/3.封装请求函数.md)
	- [4.环境变量配置](articles/4.环境变量配置.md)

## 说明

本仓库为前端小程序工程，后端服务需自行部署或接入现有服务后使用。
