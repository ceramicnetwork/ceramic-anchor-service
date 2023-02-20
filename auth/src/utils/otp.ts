import * as uuid from '@stablelib/uuid'

export const generateOTP = () => {
    if (process.env.TESTING == 'true') return '29161b43-758a-40f3-aece-97758bac617a'
    return uuid.v4()
}
