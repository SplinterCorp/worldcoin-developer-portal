import { gql } from "@apollo/client";
import { NextApiRequest, NextApiResponse } from "next";
import {
  errorNotAllowed,
  errorRequiredAttribute,
  errorValidation,
} from "src/backend/errors";
import { getAPIServiceClient } from "src/backend/graphql";
import { checkConsumerBackendForPhoneVerification } from "src/backend/utils";
import {
  PHONE_SEQUENCER,
  PHONE_SEQUENCER_STAGING,
  SEMAPHORE_GROUP_MAP,
} from "src/lib/constants";
import { CredentialType } from "src/lib/types";

const existsQuery = gql`
  query IdentityCommitmentExists($identity_commitment: String!) {
    revocation(where: { identity_commitment: { _eq: $identity_commitment } }) {
      identity_commitment
    }
  }
`;

interface ISimplifiedError {
  code: string;
  detail: string;
}

const EXPECTED_ERRORS: Record<string, ISimplifiedError> = {
  "provided identity commitment is invalid": {
    code: "unverified_identity",
    detail: "This identity is not verified for the relevant credential.",
  },
  "provided identity commitment not found": {
    code: "unverified_identity",
    detail: "This identity is not verified for the relevant credential.",
  },
};

/**
 * Checks if the given identity commitment is in the revocation table, and if false,
 * queries an inclusion proof from the relevant signup sequencer
 * @param req
 * @param res
 */
export default async function handleInclusionProof(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (!req.method || !["POST", "OPTIONS"].includes(req.method)) {
    return errorNotAllowed(req.method, res);
  }

  for (const attr of ["credential_type", "identity_commitment", "env"]) {
    if (!req.body[attr]) {
      return errorRequiredAttribute(attr, res);
    }
  }

  // TODO: Type environments
  if (!["staging", "production"].includes(req.body.env)) {
    return errorValidation(
      "invalid",
      "Invalid environment value. `staging` or `production` expected.",
      "env",
      res
    );
  }

  // TODO: Only phone credential supported for now
  if (req.body.credential_type !== "phone") {
    return errorValidation(
      "invalid",
      "Invalid credential type. Only `phone` is supported for now.",
      "credential_type",
      res
    );
  }

  const apiClient = await getAPIServiceClient();
  const isStaging = req.body.env === "production" ? false : true;

  // ANCHOR: Check if the identity commitment has been revoked
  const identityCommitmentExistsResponse = await apiClient.query({
    query: existsQuery,
    variables: { identity_commitment: req.body.identity_commitment },
  });

  if (identityCommitmentExistsResponse.data.revocation.length) {
    // Commitment is in the revocation table, deny the proof request
    console.info(
      `Declined inclusion proof request for revoked commitment: ${req.body.identity_commitment}`
    );

    return errorValidation(
      "unverified_identity",
      "This identity is not verified for the phone credential.",
      "identity_commitment",
      res
    );
  }

  // Commitment is not in the revoke table, so query sequencer for inclusion proof
  const headers = new Headers();
  headers.append(
    "Authorization",
    isStaging
      ? `Basic ${process.env.PHONE_SEQUENCER_STAGING_KEY}`
      : `Basic ${process.env.PHONE_SEQUENCER_KEY}`
  );
  headers.append("Content-Type", "application/json");
  const body = JSON.stringify([
    SEMAPHORE_GROUP_MAP[CredentialType.Phone],
    req.body.identity_commitment,
  ]);

  const response = await fetch(
    req.body.env === "production"
      ? `${PHONE_SEQUENCER}/inclusionProof`
      : `${PHONE_SEQUENCER_STAGING}/inclusionProof`,
    {
      method: "POST",
      headers,
      body,
    }
  );

  // Commitment found, return the proof
  if (response.status === 200) {
    res.status(200).json({
      inclusion_proof: await response.json(),
    });
  }

  // Commitment is still pending inclusion, return an error
  else if (response.status === 202) {
    res.status(400).json({
      code: "inclusion_pending",
      detail:
        "This identity is in progress of being included on-chain. Please wait a few minutes and try again.",
    });
  }

  // Commitment not found by the sequencer
  else if (response.status === 400) {
    const errorBody = await response.text();

    // User may have previously verified their phone number, before the phone sequencer contract was deployed
    // Check with the consumer backend if this is the case, and if so insert the identity commitment on-the-fly
    // FIXME: Disabled for now, as the phone sequencer is not yet ready
    // try {
    //   await checkConsumerBackendForPhoneVerification(req, res, isStaging);
    //   return;
    // } catch (error) {
    //   console.error(error);
    // }

    // Phone was not verified, proceed as normal
    if (Object.keys(EXPECTED_ERRORS).includes(errorBody)) {
      return res.status(400).json(EXPECTED_ERRORS[errorBody]);
    } else {
      console.error(
        "Unexpected error (400) fetching proof from phone sequencer",
        errorBody
      );
      res.status(400).json({
        code: "server_error",
        detail:
          "Unable to get proof for this identity. Please try again later.",
      });
    }
  } else {
    console.error(
      `Unexpected error (${response.status}) fetching proof from phone sequencer`,
      await response.text()
    );
    res.status(503).json({
      code: "server_error",
      detail: "Something went wrong. Please try again.",
    });
  }
}
