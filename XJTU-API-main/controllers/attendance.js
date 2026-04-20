const { getMappedBkkqAttendanceData, sanitizeStuId } = require("../util/bkkqAttendanceAdapter")

function extractStuIdFromToken(ctx) {
  const token = String((ctx.request && ctx.request.headers && ctx.request.headers.token) || "")
  const m = token.match(/xjtu-(\d+)-/i)
  return sanitizeStuId(m ? m[1] : "")
}

const getList = async (ctx, next) => {
  const stuId = extractStuIdFromToken(ctx)
  const mapped = getMappedBkkqAttendanceData(stuId)
  if (mapped) {
    const list = Array.isArray(mapped.list) ? mapped.list : []
    const byTab = mapped.byTab && typeof mapped.byTab === "object" ? mapped.byTab : {}
    const summary = mapped.summary && typeof mapped.summary === "object" ? mapped.summary : {}
    const rawTables = Array.isArray(mapped.rawTables) ? mapped.rawTables : []

    ctx.result = {
      list,
      byTab: {
        week: Array.isArray(byTab.week) ? byTab.week : [],
        month: Array.isArray(byTab.month) ? byTab.month : [],
        term: Array.isArray(byTab.term) ? byTab.term : [],
      },
      summary,
      rawTables,
      fetchedAt: mapped.fetchedAt || "",
      total: Number(mapped.total || list.length || 0),
    }
    return next()
  }

  ctx.result = {
    list: [],
    byTab: {
      week: [],
      month: [],
      term: [],
    },
    summary: {
      shouldAttend: 0,
      actualAttend: 0,
      normalCount: 0,
      late: 0,
      leave: 0,
      absences: 0,
      attendanceRate: "",
    },
    rawTables: [],
    fetchedAt: "",
    total: 0,
  }
  return next()
}

const getSimpleList = async (ctx, next) => {
  const stuId = extractStuIdFromToken(ctx)
  const mapped = getMappedBkkqAttendanceData(stuId)
  ctx.result = mapped && Array.isArray(mapped.list) ? mapped.list : []
  return next()
}

module.exports = {
  getList,
  getSimpleList,
}
