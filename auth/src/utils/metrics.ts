import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch"

export enum METRIC_NAMES {

  register = 'register',
  revoke = 'revoke',
  verify = 'verify'

}

export class CloudMetrics {
  protected base_name
  protected namespace
  protected cwclient
  constructor() {
    this.base_name = process.env.METRIC_BASE_NAME || 'cas_admin-api-testing'
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
      this.cwclient.send(cmd)
    } catch (e) {
      console.log(`Error logging metrics: ${e}`)
    }
  }
}
