"use strict"

require("dotenv").config()

const { getMappedCrawlerData } = require("../util/xjtuEhallAdapter")
const { getCollection, closeMongo } = require("../db/mongo")

async function migrateCrawlerData() {
  const mapped = getMappedCrawlerData()
  if (!mapped) {
    console.log("[migrate] No crawler JSON data found, skip crawler_data.")
    return
  }

  const collection = await getCollection("crawler_data")
  if (!collection) {
    throw new Error("Mongo is unavailable. Check DATA_SOURCE and MONGO_URI.")
  }

  const safeStuId = String(process.env.MIGRATE_STU_ID || "").trim()
  const docId = safeStuId ? `stu:${safeStuId}` : "latest"
  const now = new Date()

  await collection.updateOne(
    { _id: docId },
    {
      $set: {
        _id: docId,
        stuId: safeStuId,
        courseList: Array.isArray(mapped.courseList) ? mapped.courseList : [],
        scoreList: Array.isArray(mapped.scoreList) ? mapped.scoreList : [],
        rawScoreList: Array.isArray(mapped.rawScoreList) ? mapped.rawScoreList : [],
        sourceFile: mapped.sourceFile || "",
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true }
  )

  console.log(`[migrate] crawler_data upserted (${docId}).`)
}

async function main() {
  try {
    await migrateCrawlerData()
  } finally {
    await closeMongo().catch(() => {})
  }
}

main().catch((err) => {
  console.error("[migrate] failed:", err && err.message ? err.message : err)
  process.exitCode = 1
})

