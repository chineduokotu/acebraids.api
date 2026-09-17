import test from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import { getSmtpOptions } from '../config/email.js';
import { renderOrderEmail } from '../services/orderEmailTemplates.js';
import { sendPaymentApprovedEmail, sendOrderStatusUpdateEmail } from '../services/emailService.js';
import { approvePayment, updateOrderStatus } from '../controllers/orderController.js';
import { Order } from '../models/Order.js';
import { Product } from '../models/Product.js';

const emailEnv = {
  EMAIL_HOST_USER: 'sender@example.com',
  EMAIL_HOST_PASSWORD: 'abcd efgh ijkl mnop',
  CLIENT_URL: 'https://shop.example.com',
};
const fixture = () => ({
  _id: '000000000000000000000001',
  guestInfo: {
    firstName: 'Ada', lastName: 'Customer', email: 'customer@example.com',
    shippingAddress: { street: '1 Test Street', city: 'London', postalCode: 'SW1A 1AA', country: 'United Kingdom' },
  },
  items: [{ product: '000000000000000000000002', name: 'Braided wig', qty: 2, price: 50, variant: { color: 'Black', length: '28 inch', capSize: 'Medium' } }],
  subtotal: 100, shippingFee: 5.99, total: 105.99, currency: 'GBP',
  paymentStatus: 'awaiting_verification', paymentMethod: 'bank_transfer', orderStatus: 'pending',
  trackingCode: 'ABB-UK-TEST12', carrier: 'Royal Mail', paymentRef: 'ABB-PAY-TEST',
  notes: 'INTERNAL ADMIN NOTE',
});

test('SMTP defaults require STARTTLS; 465 uses immediate TLS; bad configuration is rejected', () => {
  const defaults = getSmtpOptions(emailEnv);
  assert.equal(defaults.host, 'smtp.gmail.com');
  assert.equal(defaults.port, 587);
  assert.equal(defaults.secure, false);
  assert.equal(defaults.requireTLS, true);
  assert.equal(defaults.auth.pass, 'abcdefghijklmnop');
  assert.equal(defaults.tls.rejectUnauthorized, true);
  const ssl = getSmtpOptions({ ...emailEnv, EMAIL_PORT: '465' });
  assert.equal(ssl.secure, true);
  assert.equal(ssl.requireTLS, false);
  assert.throws(() => getSmtpOptions({}), { code: 'EMAIL_CONFIG' });
  assert.throws(() => getSmtpOptions({ ...emailEnv, EMAIL_PORT: '25' }), { code: 'EMAIL_CONFIG' });
});

test('templates include exact subjects, stored totals, details, and escaped content', () => {
  const order = fixture();
  order.guestInfo.firstName = '<img src=x onerror=alert(1)>';
  order.items[0].name = 'Wig <script>alert(1)</script>';
  order.trackingCode = 'ABB-UK-A&B';
  const payment = renderOrderEmail('payment-approved', order, emailEnv.CLIENT_URL);
  assert.equal(payment.subject, 'Order Received & Processing');
  assert.match(payment.text, /payment has been confirmed/);
  assert.match(payment.text, /Total paid: £105\.99/);
  assert.match(payment.text, /ABB-PAY-TEST/);
  assert.match(payment.text, /Black \/ 28 inch \/ Medium/);
  assert.match(payment.html, /&lt;script&gt;/);
  assert.doesNotMatch(payment.html, /<script>|<img/);
  assert.doesNotMatch(payment.html + payment.text, /INTERNAL ADMIN NOTE/);
  assert.match(payment.text, /code=ABB-UK-A%26B/);
  const shipped = renderOrderEmail('shipped', order, emailEnv.CLIENT_URL);
  assert.equal(shipped.subject, 'Your Order Has Shipped');
  assert.match(shipped.text, /Carrier: Royal Mail/);
  assert.match(shipped.text, /Tracking \/ order reference: ABB-UK-A&B/);
  assert.match(shipped.text, /1 Test Street/);
  assert.doesNotMatch(shipped.text, /Total paid|payment has been confirmed/);
  order.currency = 'EUR';
  assert.match(renderOrderEmail('payment-approved', order).text, /€105\.99/);
});

test('optional tracking fields and invalid client URL are omitted gracefully', () => {
  const order = fixture();
  delete order.carrier;
  delete order.trackingCode;
  const template = renderOrderEmail('shipped', order, 'javascript:alert(1)');
  assert.doesNotMatch(template.html, /href=|undefined|javascript:/);
  assert.doesNotMatch(template.text, /Carrier:|Tracking \/ order reference:/);
  const withOrderId = renderOrderEmail('shipped', order, emailEnv.CLIENT_URL);
  assert.match(withOrderId.text, /code=000000000000000000000001/);
});

test('receipts explain their purpose and expose the actual tracking destination and sender', () => {
  const order = fixture();
  for (const event of ['payment-approved', 'shipped']) {
    const message = renderOrderEmail(event, order, emailEnv.CLIENT_URL, emailEnv.EMAIL_HOST_USER);
    assert.match(message.text, /Order reference: ABB-UK-TEST12/);
    assert.match(message.html, /an order was placed with AceBeautyBraids using this email address/);
    assert.match(message.text, /an order was placed with AceBeautyBraids using this email address/);
    assert.match(message.html, />https:\/\/shop\.example\.com\/order-tracking\?code=ABB-UK-TEST12<\/a>/);
    assert.match(message.text, /contact AceBeautyBraids at sender@example\.com/);
    assert.doesNotMatch(message.html, /display:\s*none|visibility:\s*hidden/);
  }
});

test('real Nodemailer produces a valid multipart receipt with one sender and matching SMTP envelope', async () => {
  // Stream transport exercises MIME composition without sending to any mailbox.
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
  const order = fixture();
  const result = await transport.sendMail({
    from: { name: 'AceBeautyBraids', address: emailEnv.EMAIL_HOST_USER },
    replyTo: emailEnv.EMAIL_HOST_USER,
    to: { address: order.guestInfo.email },
    ...renderOrderEmail('payment-approved', order, emailEnv.CLIENT_URL, emailEnv.EMAIL_HOST_USER),
  });
  assert.equal(result.envelope.from, emailEnv.EMAIL_HOST_USER);
  assert.deepEqual(result.envelope.to, [order.guestInfo.email]);
  const raw = result.message.toString('utf8');
  const headers = raw.split('\r\n\r\n')[0];
  for (const name of ['From', 'To', 'Subject', 'Date', 'Message-ID']) {
    assert.equal((headers.match(new RegExp(`^${name}:`, 'gmi')) || []).length, 1);
  }
  assert.match(headers, /^Reply-To: sender@example\.com$/m);
  assert.match(raw, /Content-Type: multipart\/alternative/i);
  assert.match(raw, /Content-Type: text\/plain; charset=utf-8/i);
  assert.match(raw, /Content-Type: text\/html; charset=utf-8/i);
});

test('controller hooks and background SMTP isolation (no database or network)', async t => {
  const previousEnv = Object.fromEntries(Object.keys(emailEnv).map(key => [key, process.env[key]]));
  Object.assign(process.env, emailEnv);
  t.after(() => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const accepted = { accepted: ['customer@example.com'], messageId: 'test-message' };
  let messages = [];
  let send = async () => accepted;
  let currentOrder;
  const transportFactory = t.mock.method(nodemailer, 'createTransport', () => ({
    sendMail: message => { messages.push(message); return send(message); },
  }));
  t.mock.method(Order, 'findById', async () => currentOrder);
  t.mock.method(Product, 'findById', async () => null);
  const warnings = t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'info', () => {});
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  const loadOrder = (changes = {}) => {
    currentOrder = new Order({ ...fixture(), ...changes });
    currentOrder.save = async function () { return this; };
    messages = [];
    send = async () => accepted;
    return currentOrder;
  };
  const approveRequest = { params: { id: fixture()._id }, user: { _id: '000000000000000000000003' } };
  const shipRequest = { params: { id: fixture()._id }, body: { orderStatus: 'shipped', carrier: 'DHL', trackingCode: 'DHL-123' } };

  await t.test('missing SMTP credentials are caught without creating a transport', async () => {
    delete process.env.EMAIL_HOST_PASSWORD;
    assert.equal(await sendPaymentApprovedEmail(fixture()), false);
    assert.equal(transportFactory.mock.callCount(), 0);
    process.env.EMAIL_HOST_PASSWORD = emailEnv.EMAIL_HOST_PASSWORD;
  });

  await t.test('approval returns before SMTP begins or finishes, and repeat approval does not resend', async () => {
    loadOrder();
    let rejectSmtp;
    send = () => new Promise((resolve, reject) => { rejectSmtp = reject; });
    const res = response();
    await approvePayment(approveRequest, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.paymentStatus, 'paid');
    assert.equal(res.body.orderStatus, 'processing');
    assert.equal(messages.length, 0);
    await tick();
    assert.equal(messages.length, 1);
    assert.equal(messages[0].subject, 'Order Received & Processing');
    assert.equal(messages[0].from.address, emailEnv.EMAIL_HOST_USER);
    assert.equal(messages[0].to.address, fixture().guestInfo.email);
    rejectSmtp(Object.assign(new Error('SECRET SMTP ERROR TEXT'), { code: 'EAUTH' }));
    await tick();
    assert.equal(res.statusCode, 200);
    assert.equal(currentOrder.paymentStatus, 'paid');
    await approvePayment(approveRequest, response());
    await tick();
    assert.equal(messages.length, 1);
    assert.doesNotMatch(JSON.stringify(warnings.mock.calls), /SECRET SMTP ERROR TEXT/);
  });

  await t.test('shipment uses saved tracking details and ignores subsequent edits or other statuses', async () => {
    loadOrder({ orderStatus: 'processing', paymentStatus: 'paid' });
    const res = response();
    await updateOrderStatus(shipRequest, res);
    assert.equal(res.body.orderStatus, 'shipped');
    assert.equal(messages.length, 0);
    await tick();
    assert.equal(messages.length, 1);
    assert.equal(messages[0].subject, 'Your Order Has Shipped');
    assert.match(messages[0].text, /Carrier: DHL/);
    assert.match(messages[0].text, /DHL-123/);
    await updateOrderStatus(shipRequest, response());
    await updateOrderStatus({ ...shipRequest, body: { notes: 'Changed note' } }, response());
    await updateOrderStatus({ ...shipRequest, body: { orderStatus: 'delivered' } }, response());
    await tick();
    assert.equal(messages.length, 1);
  });

  await t.test('SMTP rejection cannot fail a saved shipment', async () => {
    loadOrder({ orderStatus: 'processing' });
    send = async () => { throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }); };
    const res = response();
    await updateOrderStatus(shipRequest, res);
    await tick();
    assert.equal(res.statusCode, 200);
    assert.equal(currentOrder.orderStatus, 'shipped');
  });

  await t.test('failed saves, missing orders, and invalid payment transitions send no mail', async () => {
    for (const controller of [approvePayment, updateOrderStatus]) {
      loadOrder();
      currentOrder.save = async () => { throw new Error('database unavailable'); };
      const res = response();
      await controller(controller === approvePayment ? approveRequest : shipRequest, res);
      assert.equal(res.statusCode, 400);
      await tick();
      assert.equal(messages.length, 0);
    }
    currentOrder = null;
    const missing = response();
    await updateOrderStatus(shipRequest, missing);
    assert.equal(missing.statusCode, 404);
    loadOrder({ paymentStatus: 'pending' });
    const invalid = response();
    await approvePayment(approveRequest, invalid);
    assert.equal(invalid.statusCode, 400);
    await tick();
    assert.equal(messages.length, 0);
  });

  await t.test('invalid recipient and rendering failure are contained; order snapshot is stable', async () => {
    messages = [];
    const order = fixture();
    order.guestInfo.email = 'bad@example.com,second@example.com';
    assert.equal(await sendPaymentApprovedEmail(order), false);
    assert.equal(messages.length, 0);
    order.guestInfo.email = fixture().guestInfo.email;
    order.currency = 'not-a-currency';
    assert.equal(await sendPaymentApprovedEmail(order), false);
    assert.equal(messages.length, 0);
    order.currency = 'GBP';
    send = async () => accepted;
    const dispatched = sendPaymentApprovedEmail(order);
    order.total = 999;
    assert.equal(await dispatched, true);
    assert.match(messages[0].text, /Total paid: £105\.99/);
    assert.equal(await sendOrderStatusUpdateEmail(order), false);
    send = async () => ({ accepted: [], rejected: ['customer@example.com'] });
    assert.equal(await sendPaymentApprovedEmail(fixture()), false);
    assert.equal(transportFactory.mock.callCount(), 1);
  });
});
