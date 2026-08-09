# Shape of twilio-api-v2010.yaml

The readable half of this document's snapshot. Its digest beside it pins every byte but says
only that something moved; this says what moved. It is kept short on purpose, because the whole
argument for having it is that a person reads it in full.

Every figure is derived from IR alone, on the same canonical ordering as every other artefact.

`max expansion depth` is an upper bound on how deep a cycle safe expander can descend: the
longest path of the reference graph with its strongly connected components collapsed, each
component weighted by the anonymous nesting of its members. It is finite even where named
cycles exist, and named cycles do exist, which is why `schemas on a reference cycle` is a row.

## Counts

| what | count |
| --- | --- |
| nodes, operation | 197 |
| webhooks | 0 |
| schemas | 148 |
| schemas on a reference cycle | 0 |
| references, `$ref` nodes | 43 |
| references, `$cycle` nodes | 0 |
| use sites naming a schema | 110 |
| use sites inlining a schema | 1762 |
| max anonymous nesting | 4 |
| max expansion depth | 4 |

## Nodes per tag

| tag | nodes |
| --- | --- |
| Api20100401Account | 4 |
| Api20100401AddOnResult | 3 |
| Api20100401Address | 5 |
| Api20100401AllTime | 1 |
| Api20100401Application | 5 |
| Api20100401AssignedAddOn | 4 |
| Api20100401AssignedAddOnExtension | 2 |
| Api20100401AuthCallsCredentialListMapping | 4 |
| Api20100401AuthCallsIpAccessControlListMapping | 4 |
| Api20100401AuthorizedConnectApp | 2 |
| Api20100401AuthRegistrationsCredentialListMapping | 4 |
| Api20100401AvailablePhoneNumberCountry | 2 |
| Api20100401Balance | 1 |
| Api20100401Call | 5 |
| Api20100401CallNotification | 2 |
| Api20100401CallRecording | 5 |
| Api20100401CallTranscription | 2 |
| Api20100401Conference | 3 |
| Api20100401ConferenceRecording | 4 |
| Api20100401ConnectApp | 4 |
| Api20100401Credential | 5 |
| Api20100401CredentialList | 5 |
| Api20100401CredentialListMapping | 4 |
| Api20100401Daily | 1 |
| Api20100401Data | 1 |
| Api20100401DependentPhoneNumber | 1 |
| Api20100401Domain | 5 |
| Api20100401Event | 1 |
| Api20100401Feedback | 1 |
| Api20100401IncomingPhoneNumber | 5 |
| Api20100401IncomingPhoneNumberLocal | 2 |
| Api20100401IncomingPhoneNumberMobile | 2 |
| Api20100401IncomingPhoneNumberTollFree | 2 |
| Api20100401IpAccessControlList | 5 |
| Api20100401IpAccessControlListMapping | 4 |
| Api20100401Key | 4 |
| Api20100401LastMonth | 1 |
| Api20100401Local | 1 |
| Api20100401MachineToMachine | 1 |
| Api20100401Media | 1 |
| Api20100401MediaInstance | 2 |
| Api20100401Member | 3 |
| Api20100401Message | 5 |
| Api20100401Mobile | 1 |
| Api20100401Monthly | 1 |
| Api20100401National | 1 |
| Api20100401NewKey | 1 |
| Api20100401NewSigningKey | 1 |
| Api20100401Notification | 2 |
| Api20100401OutgoingCallerId | 4 |
| Api20100401Participant | 5 |
| Api20100401Payload | 3 |
| Api20100401Payment | 2 |
| Api20100401Queue | 5 |
| Api20100401Record | 1 |
| Api20100401Recording | 3 |
| Api20100401RecordingTranscription | 3 |
| Api20100401SharedCost | 1 |
| Api20100401ShortCode | 3 |
| Api20100401SigningKey | 4 |
| Api20100401SipIpAddress | 5 |
| Api20100401Siprec | 2 |
| Api20100401Stream | 2 |
| Api20100401ThisMonth | 1 |
| Api20100401Today | 1 |
| Api20100401Token | 1 |
| Api20100401TollFree | 1 |
| Api20100401Transcription | 3 |
| Api20100401Trigger | 5 |
| Api20100401UserDefinedMessage | 1 |
| Api20100401UserDefinedMessageSubscription | 2 |
| Api20100401ValidationRequest | 1 |
| Api20100401Voip | 1 |
| Api20100401Yearly | 1 |
| Api20100401Yesterday | 1 |

## Navigation, two levels

Leaf children are counted by kind rather than listed. Their ids are in the digest, which is
where a list of six hundred entries belongs. A child that is itself a group is listed in full,
because that is structure rather than content.

- group Api20100401Account (4): 4 node
- group Api20100401AddOnResult (3): 3 node
- group Api20100401Address (5): 5 node
- group Api20100401AllTime (1): 1 node
- group Api20100401Application (5): 5 node
- group Api20100401AssignedAddOn (4): 4 node
- group Api20100401AssignedAddOnExtension (2): 2 node
- group Api20100401AuthCallsCredentialListMapping (4): 4 node
- group Api20100401AuthCallsIpAccessControlListMapping (4): 4 node
- group Api20100401AuthRegistrationsCredentialListMapping (4): 4 node
- group Api20100401AuthorizedConnectApp (2): 2 node
- group Api20100401AvailablePhoneNumberCountry (2): 2 node
- group Api20100401Balance (1): 1 node
- group Api20100401Call (5): 5 node
- group Api20100401CallNotification (2): 2 node
- group Api20100401CallRecording (5): 5 node
- group Api20100401CallTranscription (2): 2 node
- group Api20100401Conference (3): 3 node
- group Api20100401ConferenceRecording (4): 4 node
- group Api20100401ConnectApp (4): 4 node
- group Api20100401Credential (5): 5 node
- group Api20100401CredentialList (5): 5 node
- group Api20100401CredentialListMapping (4): 4 node
- group Api20100401Daily (1): 1 node
- group Api20100401Data (1): 1 node
- group Api20100401DependentPhoneNumber (1): 1 node
- group Api20100401Domain (5): 5 node
- group Api20100401Event (1): 1 node
- group Api20100401Feedback (1): 1 node
- group Api20100401IncomingPhoneNumber (5): 5 node
- group Api20100401IncomingPhoneNumberLocal (2): 2 node
- group Api20100401IncomingPhoneNumberMobile (2): 2 node
- group Api20100401IncomingPhoneNumberTollFree (2): 2 node
- group Api20100401IpAccessControlList (5): 5 node
- group Api20100401IpAccessControlListMapping (4): 4 node
- group Api20100401Key (4): 4 node
- group Api20100401LastMonth (1): 1 node
- group Api20100401Local (1): 1 node
- group Api20100401MachineToMachine (1): 1 node
- group Api20100401Media (1): 1 node
- group Api20100401MediaInstance (2): 2 node
- group Api20100401Member (3): 3 node
- group Api20100401Message (5): 5 node
- group Api20100401Mobile (1): 1 node
- group Api20100401Monthly (1): 1 node
- group Api20100401National (1): 1 node
- group Api20100401NewKey (1): 1 node
- group Api20100401NewSigningKey (1): 1 node
- group Api20100401Notification (2): 2 node
- group Api20100401OutgoingCallerId (4): 4 node
- group Api20100401Participant (5): 5 node
- group Api20100401Payload (3): 3 node
- group Api20100401Payment (2): 2 node
- group Api20100401Queue (5): 5 node
- group Api20100401Record (1): 1 node
- group Api20100401Recording (3): 3 node
- group Api20100401RecordingTranscription (3): 3 node
- group Api20100401SharedCost (1): 1 node
- group Api20100401ShortCode (3): 3 node
- group Api20100401SigningKey (4): 4 node
- group Api20100401SipIpAddress (5): 5 node
- group Api20100401Siprec (2): 2 node
- group Api20100401Stream (2): 2 node
- group Api20100401ThisMonth (1): 1 node
- group Api20100401Today (1): 1 node
- group Api20100401Token (1): 1 node
- group Api20100401TollFree (1): 1 node
- group Api20100401Transcription (3): 3 node
- group Api20100401Trigger (5): 5 node
- group Api20100401UserDefinedMessage (1): 1 node
- group Api20100401UserDefinedMessageSubscription (2): 2 node
- group Api20100401ValidationRequest (1): 1 node
- group Api20100401Voip (1): 1 node
- group Api20100401Yearly (1): 1 node
- group Api20100401Yesterday (1): 1 node
- group Schemas (148): 148 schema
