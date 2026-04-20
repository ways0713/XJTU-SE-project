"use strict"

const path = require("path")

const { getDataSource, isMongoEnabled } = require("../db/mongo")
const crawlerRepo = require("../repositories/crawlerRepo")
const { getMappedCrawlerData } = require("../util/xjtuEhallAdapter")

function buildSafeMapped(raw) {
  if (!raw || typeof raw !== "object") return null
  return {
    courseList: Array.isArray(raw.courseList) ? raw.courseList : [],
    scoreList: Array.isArray(raw.scoreList) ? raw.scoreList : [],
    rawScoreList: Array.isArray(raw.rawScoreList) ? raw.rawScoreList : [],
    sourceFile: typeof raw.sourceFile === "string" ? raw.sourceFile : "",
  }
}

async function readMappedCrawlerData(stuId = "") {
  const safeStuId = String(stuId || "").trim()

  if (isMongoEnabled()) {
    if (safeStuId) {
      const fromMongoByStu = await crawlerRepo.readByStuId(safeStuId).catch(() => null)
      const safeByStu = buildSafeMapped(fromMongoByStu)
      if (safeByStu) {
        return safeByStu
      }

      return null
    }

    const fromMongo = await crawlerRepo.readLatest().catch(() => null)
    const safe = buildSafeMapped(fromMongo)
    if (safe) {
      return safe
    }
  }

  return buildSafeMapped(getMappedCrawlerData())
}

async function readAndMapCrawlerOutputFile() {
  return buildSafeMapped(getMappedCrawlerData())
}

async function saveMappedCrawlerData(mapped, stuId = "") {
  const safeStuId = String(stuId || "").trim()
  const safe = buildSafeMapped(mapped)
  if (!safe) return false
  if (!isMongoEnabled()) return false
  if (safeStuId) {
    return crawlerRepo.saveByStuId(safeStuId, safe).catch(() => false)
  }
  return crawlerRepo.saveLatest(safe).catch(() => false)
}

async function syncLatestCrawlerOutputToMongo(stuId = "") {
  if (!isMongoEnabled()) return false
  const mapped = await readAndMapCrawlerOutputFile()
  if (!mapped) return false
  return saveMappedCrawlerData(mapped, stuId)
}

async function getSummary(stuId = "") {
  const safeStuId = String(stuId || "").trim()
  const mapped = await readMappedCrawlerData(safeStuId)
  if (!mapped) {
    return {
      stuId: safeStuId,
      courseCount: 0,
      scoreTermCount: 0,
      rawScoreTermCount: 0,
      sourceFile: "",
      dataSource: getDataSource(),
    }
  }

  return {
    stuId: safeStuId,
    courseCount: Array.isArray(mapped.courseList) ? mapped.courseList.length : 0,
    scoreTermCount: Array.isArray(mapped.scoreList) ? mapped.scoreList.length : 0,
    rawScoreTermCount: Array.isArray(mapped.rawScoreList) ? mapped.rawScoreList.length : 0,
    sourceFile: mapped.sourceFile || path.resolve(__dirname, "..", "output", "xjtu-ehall.json"),
    dataSource: getDataSource(),
  }
}

module.exports = {
  readMappedCrawlerData,
  readAndMapCrawlerOutputFile,
  saveMappedCrawlerData,
  syncLatestCrawlerOutputToMongo,
  getSummary,
}

