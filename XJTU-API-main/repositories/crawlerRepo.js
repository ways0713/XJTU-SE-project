"use strict"

const { getCollection } = require("../db/mongo")

const COLLECTION_NAME = "crawler_data"
const DEFAULT_DOC_ID = "latest"

function normalizeStuId(stuId) {
  const text = String(stuId || "").trim()
  return text || ""
}

function toDocId(stuId) {
  const safeStuId = normalizeStuId(stuId)
  return safeStuId ? `stu:${safeStuId}` : DEFAULT_DOC_ID
}

function projectResult(doc) {
  if (!doc || typeof doc !== "object") return null
  return {
    stuId: typeof doc.stuId === "string" ? doc.stuId : "",
    courseList: Array.isArray(doc.courseList) ? doc.courseList : [],
    scoreList: Array.isArray(doc.scoreList) ? doc.scoreList : [],
    rawScoreList: Array.isArray(doc.rawScoreList) ? doc.rawScoreList : [],
    sourceFile: typeof doc.sourceFile === "string" ? doc.sourceFile : "",
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : "",
  }
}

async function readLatest() {
  return readByStuId("")
}

async function readByStuId(stuId) {
  const collection = await getCollection(COLLECTION_NAME)
  if (!collection) return null

  const doc = await collection.findOne({ _id: toDocId(stuId) })
  return projectResult(doc)
}

async function saveLatest(payload) {
  return saveByStuId("", payload)
}

async function saveByStuId(stuId, payload) {
  const collection = await getCollection(COLLECTION_NAME)
  if (!collection) return false

  const safeStuId = normalizeStuId(stuId)
  const now = new Date()
  const doc = {
    _id: toDocId(safeStuId),
    stuId: safeStuId,
    courseList: Array.isArray(payload && payload.courseList) ? payload.courseList : [],
    scoreList: Array.isArray(payload && payload.scoreList) ? payload.scoreList : [],
    rawScoreList: Array.isArray(payload && payload.rawScoreList) ? payload.rawScoreList : [],
    sourceFile: payload && payload.sourceFile ? String(payload.sourceFile) : "",
    updatedAt: now,
  }

  await collection.updateOne(
    { _id: toDocId(safeStuId) },
    {
      $set: doc,
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  )

  return true
}

async function ensureIndexes() {
  const collection = await getCollection(COLLECTION_NAME)
  if (!collection) return
  await collection.createIndex({ stuId: 1 })
  await collection.createIndex({ updatedAt: -1 })
}

module.exports = {
  readByStuId,
  saveByStuId,
  readLatest,
  saveLatest,
  ensureIndexes,
}

