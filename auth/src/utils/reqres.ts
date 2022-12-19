import { APIGatewayProxyStructuredResultV2 } from "aws-lambda"

type ResponseBody = { [k: string]: any }

export enum httpMethods {
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  PATCH = 'PATCH',
  DELETE = 'DELETE',
}

export const okResponse = (body?: ResponseBody, statusCode = 200) => {
  return buildResponse(statusCode, body)
}

export const errorResponse = (body?: ResponseBody, statusCode = 400) => {
  return buildResponse(statusCode, body)
}

const buildResponse = (statusCode, body?: ResponseBody): APIGatewayProxyStructuredResultV2 => {
  let response: any = { statusCode, headers: {'Content-Type': 'application/json; charset=UTF-8'} }
  body && (response = {...response, body: JSON.stringify(body)})
  return response
}
