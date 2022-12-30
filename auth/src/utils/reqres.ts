import { Request, Response } from "express"
import { Database } from "../services/db"
import { EmailService } from "../services/email"

export enum httpMethods {
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  PATCH = 'PATCH',
  DELETE = 'DELETE',
}

export type CustomContext = {
  db: Database
  email: EmailService
}

export interface Req extends Request {
  customContext: CustomContext
}

export interface Res extends Response {}

export const authBearerRegex = new RegExp(/Bearer .*/)
export const authBearerOnlyRegex = new RegExp(/Bearer /)
