import http from "k6/http";
import { BASE_URL } from "../data.js";
import { getHeaders, validate } from "../../shared/helpers.js";

/* ==============================
Create Payment
============================== */

export function createPayment(
    token,
    bookingId,
    invoiceId,
    totalAmount
){

    const timestamp = Date.now();
    const cardTypeId = __ENV.ECOM_PAYMENT_CREDIT_CARD_TYPE_ID || "2";
    const cardType = __ENV.ECOM_CREDIT_CARD_TYPE || "Mastercard";
    const last4Digits = __ENV.ECOM_LAST_4_DIGITS || "1111";
    const transactionNumber = __ENV.TRANSACTION_NUMBER || `TXN${timestamp}`;
    const authCode = __ENV.AUTH_CODE || String(100000 + Math.floor(Math.random() * 900000));
    const paymentDate = __ENV.PAYMENT_DATE || new Date().toISOString();
    const paymentRef = __ENV.PAYMENT_REF || (bookingId ? `ECOM_${bookingId}_${timestamp}` : `ECOM_${timestamp}`);
    const amount = totalAmount != null ? String(totalAmount) : "0";

    const payload = {
        data:{
            relationships:{
                booking:{
                    data:{
                        id:bookingId,
                        type:"booking"
                    }
                },
                currency:{
                    data:{
                        id:"2",
                        type:"currency"
                    }
                },
                invoice:{
                    data:[
                        {
                            id:invoiceId,
                            type:"invoice"
                        }
                    ]
                }
            },
            attributes:{
                allocatedAmount:amount,
                paidAmount:amount,
                currencyRate:1,
                creditCardTypeID:cardTypeId,
                creditCardType:cardType,
                transactionNumber,
                authorisationCode:authCode,
                paymentDate,
                last4Digits,
                paymentRef
            },
            type:"creditCardReceipt"
        }
    };

    const res = http.post(
        `${BASE_URL}/api/V4.1/payments`,
        JSON.stringify(payload),
        getHeaders(token)
    );

    validate(res, "Create Payment", { bookingId, invoiceId }, { requestBody: payload });
    
    if (res.status !== 200 && res.status !== 201) {
        console.error("❌ CREATE PAYMENT FAILURE");
        console.error("BookingID:", bookingId, "InvoiceID:", invoiceId);
        console.error("Status:", res.status);
        console.error("Response:", res.body);
        return null;
    }

    let body;

    try{
        body = res.json();
    }catch(e){
        console.error("Payment response not JSON");
        console.error(res.body);
        return null;
    }

    return body?.data?.id || null;
}


/* ==============================
Payment Select
============================== */

export function paymentSelect(token,bookingId){

    const res = http.get(
        `${BASE_URL}/api/V4.1/bookings/${bookingId}/payments`,
        getHeaders(token)
    );

    validate(res,"Payment Select",{bookingId});

    let body;

    try{
        body = res.json();
    }catch(e){
        return null;
    }

    if(!body?.data?.length){
        return null;
    }

    const firstPayment = body.data[0];

    return {
        paymentId:firstPayment?.id,
        paidAmount:firstPayment?.attributes?.paidAmount
    };
}


/* ==============================
Payment Schedule
============================== */

export function paymentSchedule(token,bookingId){

    const res = http.get(
        `${BASE_URL}/api/V4.1/bookings/${bookingId}/payment-schedule`,
        getHeaders(token)
    );

    validate(res,"Payment Schedule",{bookingId});

    let body;

    try{
        body = res.json();
    }catch(e){
        return null;
    }

    if(!body?.data?.length){
        return null;
    }

    return body.data;
}

/* ==============================
Payment Credit Card Types
============================== */

export function paymentCreditCardTypes(token){

    const res = http.get(
        `${BASE_URL}/api/V4.1/payments/credit-card-types`,
        getHeaders(token)
    );

    validate(res, "Payment Credit Card Types");

    let body;
    try{
        body = res.json();
    }catch(e){
        return null;
    }

    if(!body?.data?.length){
        return null;
    }

    return body.data;
}