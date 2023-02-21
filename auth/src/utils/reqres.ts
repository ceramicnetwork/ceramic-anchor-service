import { Request, Response } from "express"
import { Database } from "../services/db.js"
import { EmailService } from "../services/email.js"
import { KeyService } from "../services/key.js"

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
  gateway: KeyService
}

export interface Req extends Request {
  customContext: CustomContext
}

export interface Res extends Response {}
