import fetch, { Response } from 'node-fetch'
import { SuperTest, Test } from 'supertest'

import { APPLICATION } from '@config/index'

import { getClaims } from '@/jwt'

export interface UserLoginData {
  email: string
  password: string
}

export type UserData = UserLoginData & {
  id: string
  token: string
  refreshToken: string
  jwtToken: string
}

export const generateRandomString = (): string => Math.random().toString(36).replace('0.', '')

export const generateRandomEmail = () => `${generateRandomString()}@${generateRandomString()}.com`

const getUserId = (token: string): string => getClaims(token)['x-hasura-user-id']

export function withEnv(
  env: Record<string, string>,
  agent: SuperTest<Test>,
  cb: (done: (...args: any[]) => any) => any,
  done: (...args: any[]) => any
) {
  agent
    .post('/change-env')
    .send(env)
    .then(() => {
      cb((...args: any[]) => {
        agent
          .post('/reset-env')
          .then(() => done(...args))
          .catch(() => done(...args))
      })
    })
}

export const createAccountLoginData = (): UserLoginData => ({
  email: `${generateRandomString()}@${generateRandomString()}.com`,
  password: generateRandomString()
})

export const registerAccount = async (
  agent: SuperTest<Test>,
  customRegisterData: Record<string, unknown> = {}
): Promise<UserLoginData> => {
  const userLoginData = createAccountLoginData()

  return new Promise((resolve, reject) => {
    withEnv(
      {
        REGISTRATION_CUSTOM_FIELDS: Object.keys(customRegisterData).join(','),
        JWT_CUSTOM_FIELDS: Object.keys(customRegisterData).join(',')
      },
      agent,
      async (done) => {
        await agent
          .post('/register')
          .send({
            ...userLoginData
          })
          .then(() => {
            done(userLoginData)
          })
          .catch(reject)
      },
      resolve
    )
  })
}

export const loginAccount = async (
  agent: SuperTest<Test>,
  userLoginData: UserLoginData
): Promise<UserData> => {
  const login = await agent.post('/login').send(userLoginData)

  console.log('login body in login Account (utils):')
  console.log(login.body)

  getUserId(login.body.jwtToken)

  if (login.body.error) {
    throw new Error(`${login.body.statusCode} ${login.body.error}: ${login.body.message}`)
  }

  return {
    ...userLoginData,
    token: login.body.jwtToken as string,
    refreshToken: login.body.refreshToken as string,
    jwtToken: login.body.jwtToken as string,
    id: getUserId(login.body.jwtToken)
  }
}

export const registerAndLoginAccount = async (agent: SuperTest<Test>) => {
  return await loginAccount(agent, await registerAccount(agent))
}

interface MailhogEmailAddress {
  Relays: string | null
  Mailbox: string
  Domain: string
  Params: string
}

interface MailhogMessage {
  ID: string
  From: MailhogEmailAddress
  To: MailhogEmailAddress[]
  Content: {
    Headers: {
      'Content-Type': string[]
      Date: string[]
      From: string[]
      'MIME-Version': string[]
      'Message-ID': string[]
      Received: string[]
      'Return-Path': string[]
      Subject: string[]
      To: string[]
      [key: string]: string[]
    }
    Body: string
    Size: number
  }
  Created: string
  Raw: {
    From: string
    To: string[]
    Data: string
  }
}

export interface MailhogSearchResult {
  total: number
  count: number
  start: number
  items: MailhogMessage[]
}

export const mailHogSearch = async (query: string, fields = 'to'): Promise<MailhogMessage[]> => {
  const response = await fetch(
    `http://${APPLICATION.SMTP_HOST}:8025/api/v2/search?kind=${fields}&query=${query}`
  )
  return ((await response.json()) as MailhogSearchResult).items
}

export const deleteMailHogEmail = async ({ ID }: MailhogMessage): Promise<Response> =>
  await fetch(`http://${APPLICATION.SMTP_HOST}:8025/api/v1/messages/${ID}`, { method: 'DELETE' })

export const deleteEmailsOfAccount = async (email: string): Promise<void> =>
  (await mailHogSearch(email)).forEach(async (message) => await deleteMailHogEmail(message))

export const getHeaderFromLatestEmailAndDelete = async (email: string, header: string) => {
  const [message] = await mailHogSearch(email)

  if (!message || !message.Content.Headers[header]) return

  const headerValue = message.Content.Headers[header][0]
  await deleteMailHogEmail(message)

  return headerValue
}

export const deleteUser = async (agent: SuperTest<Test>, user: UserLoginData): Promise<void> => {
  // * Delete the user
  await agent.post('/delete')
  // * Remove any message sent to this user
  await deleteEmailsOfAccount(user.email)
}
