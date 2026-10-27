// Netlify Function - 공공데이터 API 프록시
// 파일 위치: netlify/functions/api-proxy.js

exports.handler = async function(event, context) {
  // CORS 헤더 설정
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };

  // OPTIONS 요청 처리 (CORS preflight)
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  try {
    // 쿼리 파라미터 가져오기
    const { endpoint, serviceKey, ...params } = event.queryStringParameters || {};

    if (!endpoint || !serviceKey) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'endpoint와 serviceKey가 필요합니다' 
        })
      };
    }

    // API URL 구성
    const baseUrl = 'https://apis.data.go.kr/1471000/DrugPrdtPrmsnInforService05';
    const queryParams = new URLSearchParams({
      serviceKey: decodeURIComponent(serviceKey),
      ...params
    });

    const apiUrl = `${baseUrl}/${endpoint}?${queryParams}`;

    // API 호출
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    const data = await response.text();

    // 응답 반환
    return {
      statusCode: response.status,
      headers: {
        ...headers,
        'Content-Type': 'application/json'
      },
      body: data
    };

  } catch (error) {
    console.error('API 프록시 에러:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: '서버 오류가 발생했습니다',
        details: error.message 
      })
    };
  }
};
