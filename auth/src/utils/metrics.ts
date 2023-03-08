import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch"

export enum METRIC_NAMES {

  register = 'did_registration_total',
  revoke = 'did_revocation_total',
  otp_request = 'otp_request_total'

}

export class CloudMetrics {
  protected base_name
  protected namespace
  protected cwclient
  constructor() {
    this.base_name = process.env.METRIC_BASE_NAME || 'cas_auth_did-testing'
    this.namespace = process.env.METRIC_NAMESPACE || 'CeramicAnchorService'
    try {
      this.cwclient = new CloudWatchClient({})
      console.log(`Instantiated CloudWatchClient with base ${this.base_name} and namespace ${this.namespace}`)
    } catch (e) {
      console.log(`Error instantiating CloudWatchClient: ${e}`)
    }
  }
 
  async count(label: string, value = 1, params?: any): void {
    const metric_name = this.base_name + '_' + label
    try {
      const cmd = new PutMetricDataCommand({
         'MetricData': [ {
            'MetricName': metric_name, 
            'Value': value } ],
         'Namespace': this.namespace})
      console.log("Sending " + cmd)
      await this.cwclient.send(cmd)
      console.log("Sent!")
    } catch (e) {
      console.log(`Error logging metrics: ${e}`)
    }
  }
}
