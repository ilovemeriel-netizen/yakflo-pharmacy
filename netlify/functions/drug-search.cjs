exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' }
  }

  const { query = '', page = '1' } = event.queryStringParameters || {}

  if (!query.trim()) {
    return errorResponse(400, '검색어를 입력해 주세요')
  }

  const API_KEY = process.env.MFDS_API_KEY
  if (!API_KEY) {
    return errorResponse(500, 'API 키가 설정되지 않았습니다')
  }

  const BASE_URL = 'http://apis.data.go.kr/1471000/DrugPrdtPrmsnInfoService04/getDrugPrdtPrmsnDtlInq04'

  const params = new URLSearchParams({
    serviceKey: API_KEY,
    item_name:  query.trim(),
    pageNo:     page,
    numOfRows:  '10',
    type:       'json'
  })

  try {
    const response = await fetch(`${BASE_URL}?${params.toString()}`)
    const text = await response.text()

    if (text.startsWith('<')) {
      if (text.includes('SERVICE_KEY_IS_NOT_REGISTERED_ERROR')) {
        return errorResponse(401, 'API 키가 유효하지 않습니다')
      }
      return errorResponse(502, '공공API 오류: ' + text.substring(0, 200))
    }

    const data = JSON.parse(text)
    const body  = data?.body || {}
    const items = body?.items || []

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        success:    true,
        totalCount: body?.totalCount || 0,
        page:       parseInt(page),
        items:      Array.isArray(items) ? items : [items].filter(Boolean)
      })
    }
  } catch (err) {
    return errorResponse(500, '검색 중 오류: ' + err.message)
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