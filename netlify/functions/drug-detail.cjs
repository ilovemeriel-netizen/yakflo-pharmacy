exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' }
  }

  const { itemName = '', itemSeq = '' } = event.queryStringParameters || {}

  if (!itemName.trim() && !itemSeq.trim()) {
    return errorResponse(400, '약품명이 필요합니다')
  }

  const API_KEY = process.env.MFDS_API_KEY
  if (!API_KEY) {
    return errorResponse(500, 'API 키가 설정되지 않았습니다')
  }

  const BASE_URL = 'http://apis.data.go.kr/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList'

  const params = new URLSearchParams({
    serviceKey: API_KEY,
    pageNo:     '1',
    numOfRows:  '5',
    type:       'json'
  })
  if (itemName.trim()) params.append('itemName', itemName.trim())
  if (itemSeq.trim())  params.append('itemSeq', itemSeq.trim())

  try {
    const response = await fetch(`${BASE_URL}?${params.toString()}`)
    const text = await response.text()

    if (text.startsWith('<')) {
      return errorResponse(502, '공공API 오류: ' + text.substring(0, 200))
    }

    const data  = JSON.parse(text)
    const items = data?.body?.items || []

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        success: true,
        items:   Array.isArray(items) ? items : [items].filter(Boolean)
      })
    }
  } catch (err) {
    return errorResponse(500, err.message)
  }
}

function corsHeaders() {
  return {
    'Content-Type':                 'application/json',
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  }
}

function errorResponse(statusCode, message) {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify({ success: false, error: message })
  }
}