"use strict"

const { getCollection } = require("../db/mongo")

const COLLECTION_NAME = "ddls"

function normalizeStuId(stuId) {
  return String(stuId || "").trim()
}

function buildDocId(stuId, id) {
  return `${normalizeStuId(stuId)}:${String(id || "").trim()}`
}

function projectItem(doc) {
  if (!doc || typeof doc !== "object") return null
  return {
    id: String(doc.id || ""),
    title: String(doc.title || ""),
    course: String(doc.course || ""),
    deadline: String(doc.deadline || ""),
    done: !!doc.done,
  }
}

async function listByStuId(stuId) {
  const safeStuId = normalizeStuId(stuId)
  if (!safeStuId) return null
  const collection = await getCollection(COLLECTION_NAME)
  if (!collection) return null

  const docs = await collection.find({ stuId: safeStuId }).sort({ deadline: 1, id: 1 }).toArray()
  return docs.map(projectItem).filter(Boolean)
}

async function replaceByStuId(stuId, list) {
  const safeStuId = normalizeStuId(stuId)
  if (!safeStuId) return false
  const collection = await getCollection(COLLECTION_NAME)
  if (!collection) return false

  const safeList = Array.isArray(list) ? list : []
  const now = new Date()
  const docs = safeList.map((item) => {
    const safeId = String(item && item.id ? item.id : "").trim()
    return {
      _id: buildDocId(safeStuId, safeId),
      stuId: safeStuId,
      id: safeId,
      title: String(item && item.title ? item.title : ""),
      course: String(item && item.course ? item.course : ""),
      deadline: String(item && item.deadline ? item.deadline : ""),
      done: !!(item && item.done),
      updatedAt: now,
    }
  })

  await collection.deleteMany({ stuId: safeStuId })
  if (!docs.length) return true
  await collection.insertMany(docs, { ordered: false })
  return true
}

async function updateDoneByStuId(stuId, id, done) {
  const safeStuId = normalizeStuId(stuId)
  const safeId = String(id || "").trim()
  if (!safeStuId || !safeId) return null
  const collection = await getCollection(COLLECTION_NAME)
  if (!collection) return null

  const now = new Date()
  const result = await collection.findOneAndUpdate(
    { _id: buildDocId(safeStuId, safeId) },
    { $set: { done: !!done, updatedAt: now } },
    { returnDocument: "after" }
  )
  return projectItem(result)
}

async function ensureIndexes() {
  const collection = await getCollection(COLLECTION_NAME)
  if (!collection) return
  await collection.createIndex({ stuId: 1, id: 1 }, { unique: true })
  await collection.createIndex({ stuId: 1, deadline: 1 })
  await collection.createIndex({ updatedAt: -1 })
}

module.exports = {
  listByStuId,
  replaceByStuId,
  updateDoneByStuId,
  ensureIndexes,
}

