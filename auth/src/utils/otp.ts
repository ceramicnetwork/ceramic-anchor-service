import { randomUUID } from 'crypto'

export const generateOTP = () => {
    if (process.env.TESTING == 'true') return '29161b43-758a-40f3-aece-97758bac617a'
    return randomUUID()
}
