const { getRequestToken } = require("../util/util")
const path = require("path")
const SCHOOL_CODE = require("../util/config")("SCHOOL_CODE")
const servicePath = `${path.resolve(__dirname, "../services")}/${SCHOOL_CODE}`
const services = require(servicePath)

function parseRisk(item = {}) {
  const rawText = `${item.reason || ""}${item.mark || ""}`.toLowerCase()
  if (
    rawText.includes("缺勤") ||
    rawText.includes("旷课") ||
    rawText.includes("absent")
  ) {
    return "danger"
  }
  if (rawText.includes("迟到") || rawText.includes("late")) {
    return "warning"
  }
  return "normal"
}

function normalizeAttendanceItems(source = []) {
  const flat = []
  source.forEach((term) => {
    const list = Array.isArray(term.attendanceList) ? term.attendanceList : []
    list.forEach((item) => {
      flat.push({
        courseName: item.course || item.courseName || "未知课程",
        teacher: item.teacher || "未知老师",
        absences: item.absences || 0,
        late: item.late || 0,
        leave: item.leave || 0,
        risk: item.risk || parseRisk(item),
      })
    })
  })
  return flat
}

// 获取考勤原始结构（兼容旧接口）
const getList = async (ctx, next) => {
  const cookie = getRequestToken(ctx)
  try {
    const attendances = await services.getAttendanceList(cookie)
    ctx.result = attendances
  } catch (err) {
    if (err && err.code !== undefined) {
      ctx.errCode = err.code
    }
    ctx.errMsg = err.message
  }
  return next()
}

// 获取前端考勤页结构
const getSimpleList = async (ctx, next) => {
  const cookie = getRequestToken(ctx)
  try {
    const attendances = await services.getAttendanceList(cookie)
    ctx.result = normalizeAttendanceItems(attendances)
  } catch (err) {
    if (err && err.code !== undefined) {
      ctx.errCode = err.code
    }
    ctx.errMsg = err.message
  }
  return next()
}

module.exports = {
  getList,
  getSimpleList,
}
