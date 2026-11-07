new OSPAY Collection Documentation
Page content
Last edit
Administrator
05/15/2026
OSPAY Collection Documentation
Core Payment Interface Parameters
F

Parameter Description
Merchant Key Please contact business team to obtain
Merchant ID Please check in User - Security Key - Merchant Key
Payment Submit Gateway https://ospayi.top/api/pay
Payment Query Gateway https://ospayi.top/api/status/ds
Balance Query Gateway https://ospayi.top/api/balance
Callback IP Please contact business team to obtain, please add to callback server whitelist
Important Notice - Please Read Carefully
Attention:

Interface Request Method : All are form submission methods, not JSON format
Request Header Settings : Please include normal browser header user-agent, otherwise may be intercepted
Signature Error Troubleshooting : Please verify signature fields and merchant key, pay attention to distinguish between Google key and merchant key

1. Payment Submission
   Request URL: https://ospayi.top/api/pay

Request Type: POST

Content-Type: application/x-www-form-urlencoded

Request Parameters
Parameter Description Signed Remarks
mer_id Merchant ID Yes
order_id Merchant Order ID Yes
gateway Payment Channel Code Yes 1001,1002 refer to channel code table below
amount Order Amount Yes Integer, such as 280, 300, 500, etc., do not add decimals
callback Synchronous Callback URL Yes Payment success redirect URL
notify Asynchronous Notification URL Yes URL to receive asynchronous notifications
remark Remarks No Not required; does not participate in signature; if provided during order placement, it will be returned in callback with the same value
realname Customer Real Name No Not required; does not participate in signature; required for some channels, such as card-to-card channels
player_ip Customer Real IP No Required ; does not participate in signature; please ensure to send customer's real IP field, helps improve channel success rate
user_id User ID No Not required; does not participate in signature; unique identifier for user recharge: User ID (ensure uniqueness)
sign Signature No See signature description below
Signature Description
Fields with “Signed” as “Yes” need to participate in signature
Parameter names sorted in dictionary ascending order (ASCII code from small to large)
sign = UPPERCASE(md5(k1=v1&k2=v2&k3=v3&…kN=vN&key=merchant_key))
Response Parameters
After getting the data field, redirect directly; code 0 means normal, others indicate errors

{
"code": 0,
"data": "http://a.com/api/order/IlMyMDIyMDgxOTIzNDQwMTIyMjc4MzQ2NDMyMyI.Yv-vwQ.ixJnFAKO0zP_pvSaoTj7p4CFmZA",
"message": "Order placed successfully",
"upi": "**.0013-1@oksbi",
"amount": "300.00",
"token": "IlMxNzA2OTY4NzMwMTE4NTY2NTAwMyI.Zb5Gmg.KEvJ3l1tGcae3VGo2d1vxas8\***",
"order_code": "S17069687301185665\*\*\*"
}
1.1 UTR Payment Submission
Token Usage Instructions:

Upload Interface: https://ospayi.top/api/ord/card_num/{token}
Request Method: POST
Parameter Name: card_num
Return Description: code 0 means upload normal, order validity period is 5 minutes
1.2 Collection Order UTR Supplementation
Request URL: https://ospayi.top/api/pay/ds/utr

Request Type: POST

Content-Type: application/x-www-form-urlencoded

Request Parameters
Parameter Description Signed Remarks
mer_id Merchant ID Yes
utr UTR Number Yes
order_id Merchant Order ID Yes
sign Signature No
Response Example
code 0 means normal, others indicate errors, orders that cannot be supplemented should be submitted to customer service

{
"code": 0,
"data": null,
"message": "success"
} 2. Payment Callback
Request URL: notify parameter passed in payment submission interface

Request Type: POST

Request Parameters
Parameter Description Signed Remarks
mer_id Merchant ID Yes
order_id Merchant Order ID Yes
status Order Status Yes OK for success; error for failure, no processing needed
amount Order Amount Yes
realpay Settlement Amount Yes Amount actually added to merchant balance
remark Remarks No Does not participate in signature; this parameter is the remark parameter submitted during order placement, if not provided during order placement, this parameter will not be passed in callback
sign Signature No Same signature description as above
Callback Handling
Important Notice: After receiving notification and successful operation, return string ok, not returning or returning other information is considered unsuccessful notification, will notify multiple times

3. Payment Channel Code Description
   Code Description Remarks
   1001 UPI Wake AND QR Code
   1002 UPI-Original Native
   1003 Card to Card Card Transfer
   1004 Wake Wake-up
   1005 Decimal Point Wake-up Decimal Wake-up
4. Payment Query
   Request URL: https://ospayi.top/api/status/ds

Request Type: POST

Request Parameters
Parameter Description Signed Remarks
mer_id Merchant ID Yes
order_id Merchant Order ID Yes
sign Signature No Same signature description as above
Response Parameters
Parameter Sub-parameter Description Signed Remarks
code - Status Code No 0 means request successful; other values ​​are request failure, please refer to message parameter
message - Error Description No When code is 0, this parameter is empty; other cases return interface error description
data - Data Object No null when interface request fails
status Order Status No 0: Payment successful; 1: Processing; 2: Payment failed
order_id Merchant Order ID No -
order_code System Order ID No Order ID generated by this system
amount Order Amount No -
realpay Settlement Amount No Amount actually deducted from merchant balance, order amount - handling fee
time_create Order Creation Time No -
time_finish Order Completion Time No If status=1 (processing), this parameter is null
utr UTR Number No Order UTR (if available, return, otherwise empty string)
upi UPI Address No Order UPI (if available, return, otherwise empty string)
Response Examples
Interface Request Failure Example
{
"code": 10056,
"data": null,
"message": "Order information error"
}
Interface Request Success Example
{
"code": 0,
"data": {
"order_id": "2020030818204961476",
"order_code": "F17062784644**",
"amount": "100.0000",
"realpay": "97.0000",
"time_create": "2020-03-08 18:20:49",
"time_finish": "2020-03-08 18:21:50",
"utr": "\*\*\***",
"upi": "**\***",
"status": 0
},
"message": ""
} 5. Merchant Balance Query
Request URL: https://ospayi.top/api/balance

Request Type: POST

Request Parameters
Parameter Description Signed Remarks
mer_id Merchant ID Yes
sign Signature No Same signature description as above
Response Parameters
Parameter Sub-parameter Description Signed Remarks
code - Status Code No 0 means request successful; other values ​​are request failure, please refer to message parameter
message - Error Description No When code is 0, this parameter is empty; other cases return interface error description
data - Data Object No null when interface request fails
balance Total Merchant Balance No -
frozen Frozen Balance No -
available Available Balance No Available balance = Total merchant balance - Frozen balance
Response Examples
Interface Request Failure Example
{
"code": 10041,
"data": null,
"message": "Signature verification failed!!"
}
Interface Request Success Example
{
"code": 0,
"message": "",
"data": {
"balance": "159853.0509",
"frozen": "20000.0000",
"available": "139853.0509"
}
} 6. Signature DEMO
6.1 PHP Example

<?php

// Data formatting
function dataFormat($args)
{
    $signPars = "";
    ksort($args);
    foreach($args as $k => $v) {
        if ("" != $v && "sign" != $k) {
            $signPars .= $k . "=" . $v . "&";
        }
    }
    return $signPars;
}

// Create signature
function createSign($args, $key)
{
    $signPars = dataFormat($args);
    $signPars .= "&key=" . $key; // key secret
    $sign = md5($signPars);
    $sign = strtoupper($sign); // Convert to uppercase
    return $sign; // Final signature
}

// Verify signature
function verifySign($data, $sign, $key)
{
    if (createSign($data, $key) == $sign) {
        return true;
    } else {
        return false;
    }
}

// Example parameters
$params['mer_id'] = 10005;
$params['order_id'] = '20191007081959123456789';
$params['gateway'] = '1001';
$params['amount'] = 100;
$params['callback'] = 'http://demo.com/callback';
$params['notify'] = 'http://demo.com/notify';
$key = '7ff65e20a05335f5d029c84ae3fca12f';

// Generate signature
$signature = createSign($params, $key);
echo $signature . "\n";

// Verify signature
$result = verifySign($params, $signature, $key);
echo $result ? 'true' : 'false' . "\n";
?>

6.2 Python Example
import hashlib

class Sign(object):
"""MD5 signature and verification"""

    @classmethod
    def data_processing(cls, data):
        """
        Data processing
        :param data: Data to be signed, dictionary type
        :return: Processed string, format: parameter_name=parameter_value, connected with &
        """
        if "sign" in data:
            del data["sign"]
        if "sign_type" in data:
            del data["sign_type"]

        data_list = []
        for key in sorted(data):
            if data[key]:
                data_list.append("%s=%s" % (key, data[key]))
        return "&".join(data_list).strip()

    @classmethod
    def sign(cls, data, api_key):
        """
        MD5 signature
        :param data: Data to be signed
        :param api_key: String required for MD5 signature
        :return: Signed string sign
        """
        data_str = cls.data_processing(data) + "&key=" + api_key.strip()
        md5 = hashlib.md5()
        md5.update(data_str.encode(encoding='UTF-8'))
        return md5.hexdigest().upper()

    @classmethod
    def verify(cls, data, signature, api_key):
        """
        MD5 verification
        :param data: Received data
        :param signature: Received sign
        :param api_key: Merchant key
        :return: Verification result, boolean value
        """
        return cls.sign(data, api_key) == signature

# Example usage

if **name** == "**main**":
params = {
'mer_id': 10005,
'order_id': '20191007081959123456789',
'gateway': '1001',
'amount': 100,
'callback': 'http://demo.com/callback',
'notify': 'http://demo.com/notify'
}
key = '7ff65e20a05335f5d029c84ae3fca12f'

    # Generate signature
    signature = Sign.sign(params, key)
    print(f"Signature: {signature}")

    # Verify signature
    result = Sign.verify(params, signature, key)
    print(f"Verification result: {result}")
