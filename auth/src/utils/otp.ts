// Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// import { CreateAuthChallengeTriggerHandler } from 'aws-lambda'
import { v4 as uuidv4 } from 'uuid'

export const generateOTP = () => {
    if (process.env.TESTING == 'true') return '29161b43-758a-40f3-aece-97758bac617a'
    return uuidv4()
}

// export const challenge = async event => {

//     let secretLoginCode: string;
//     if (!event.request.session || !event.request.session.length) {

//         // This is a new auth session
//         // Generate a new secret login code and mail it to the user
//         secretLoginCode = generateOTP()
//         await sendEmail(event.request.userAttributes.email, secretLoginCode);

//     } else {

//         // There's an existing session. Don't generate new digits but
//         // re-use the code from the current session. This allows the user to
//         // make a mistake when keying in the code and to then retry, rather
//         // then needing to e-mail the user an all new code again.    
//         const previousChallenge = event.request.session.slice(-1)[0];
//         secretLoginCode = previousChallenge.challengeMetadata!.match(/CODE-(\d*)/)![1];
//     }

//     // This is sent back to the client app
//     event.response.publicChallengeParameters = { email: event.request.userAttributes.email };

//     // Add the secret login code to the private challenge parameters
//     // so it can be verified by the "Verify Auth Challenge Response" trigger
//     event.response.privateChallengeParameters = { secretLoginCode };

//     // Add the secret login code to the session so it is available
//     // in a next invocation of the "Create Auth Challenge" trigger
//     event.response.challengeMetadata = `CODE-${secretLoginCode}`;

//     return event;
// };
