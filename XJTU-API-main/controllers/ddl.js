const CACHE_KEY = "__XJTU_DDL_LIST__"
const { getMappedSyxtDdlData, sanitizeStuId } = require("../util/syxtDdlAdapter")
const { isMongoEnabled } = require("../db/mongo")
const ddlRepo = require("../repositories/ddlRepo")

function getDefaultList() {
  return [
    {
      id: "ddl-1",
      title: "软件工程立项报告提交",
      course: "软件工程",
      deadline: "2026-04-20 23:59",
      done: false,
    },
    {
      id: "ddl-2",
      title: "计算机网络实验二",
      course: "计算机网络",
      deadline: "2026-04-23 18:00",
      done: false,
    },
    {
      id: "ddl-3",
      title: "高数作业第三章",
      course: "高等数学",
      deadline: "2026-04-18 22:00",
      done: true,
    },
  ]
}

function getListFromMemory() {
  if (!global[CACHE_KEY]) {
    global[CACHE_KEY] = getDefaultList()
  }
  return global[CACHE_KEY]
}

const getList = async (ctx, next) => {
  const token = (ctx.request && ctx.request.headers && ctx.request.headers.token) || ""
  const stuIdFromToken = sanitizeStuId(String(token || "").match(/xjtu-(\d+)-/i)?.[1] || "")

  if (isMongoEnabled() && stuIdFromToken) {
    const mongoList = await ddlRepo.listByStuId(stuIdFromToken).catch(() => null)
    if (Array.isArray(mongoList) && mongoList.length) {
      ctx.result = mongoList
      return next()
    }
  }

  const mapped = getMappedSyxtDdlData(stuIdFromToken)
  if (mapped && Array.isArray(mapped.list) && mapped.list.length) {
    if (isMongoEnabled() && stuIdFromToken) {
      await ddlRepo.replaceByStuId(stuIdFromToken, mapped.list).catch(() => false)
    }
    ctx.result = mapped.list
    return next()
  }

  ctx.result = getListFromMemory()
  return next()
}

const updateItem = async (ctx, next) => {
  const id = ctx.params.id
  const { done } = ctx.request.body || {}
  const token = (ctx.request && ctx.request.headers && ctx.request.headers.token) || ""
  const stuIdFromToken = sanitizeStuId(String(token || "").match(/xjtu-(\d+)-/i)?.[1] || "")
  if (!id) {
    ctx.errCode = -1
    ctx.errMsg = "DDL id不能为空"
    return next()
  }
  if (typeof done !== "boolean") {
    ctx.errCode = -1
    ctx.errMsg = "done字段必须为boolean"
    return next()
  }

  if (isMongoEnabled() && stuIdFromToken) {
    const updated = await ddlRepo.updateDoneByStuId(stuIdFromToken, id, done).catch(() => null)
    if (updated) {
      ctx.result = updated
      return next()
    }
  }

  const list = getListFromMemory()
  const item = list.find((i) => i.id === id)
  if (!item) {
    ctx.errCode = -1
    ctx.errMsg = "DDL不存在"
    return next()
  }
  item.done = done
  ctx.result = item
  return next()
}

module.exports = {
  getList,
  updateItem,
}
