const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

const getTrackingUrl = (clientUrl, reference) => {
  if (!clientUrl || !reference) return null;
  try {
    const url = new URL('/order-tracking', clientUrl);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    url.searchParams.set('code', reference);
    return url.href;
  } catch {
    return null;
  }
};

export const renderOrderEmail = (event, order, clientUrl, senderAddress = '') => {
  const payment = event === 'payment-approved';
  if (!payment && event !== 'shipped') throw new Error('Unsupported email event');

  const subject = payment ? 'Order Received & Processing' : 'Your Order Has Shipped';
  const intro = payment
    ? "Your payment has been confirmed. We've received your order and are now preparing it."
    : "Your order has been shipped. You'll find your order summary and available tracking details below.";
  const status = payment ? 'Payment confirmed · Processing' : 'Shipped';
  const name = order.guestInfo?.firstName || 'there';
  const orderId = String(order._id || '');
  const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: order.currency || 'GBP' });
  const format = amount => money.format(Number(amount) || 0);
  const items = (order.items || []).map(item => ({
    name: item.name || 'Product',
    variant: [item.variant?.color, item.variant?.length, item.variant?.capSize].filter(Boolean).join(' / ') || item.variant?.label || '',
    qty: item.qty,
    price: format(item.price),
    total: format(Number(item.price) * Number(item.qty)),
  }));
  const totals = [
    ['Subtotal', format(order.subtotal)],
    ['Shipping', format(order.shippingFee)],
    [payment ? 'Total paid' : 'Order total', format(order.total)],
  ];
  const address = order.guestInfo?.shippingAddress;
  const addressLines = address ? [
    [order.guestInfo?.firstName, order.guestInfo?.lastName].filter(Boolean).join(' '),
    address.street, address.apartment, address.city, address.county, address.postalCode, address.country,
  ].filter(Boolean) : [];
  const details = [
    ...(order.trackingCode ? [['Order reference', order.trackingCode]] : []),
    ['Order ID', orderId],
    ['Status', status],
    ...(payment && order.paymentRef ? [['Payment reference', order.paymentRef]] : []),
    ...(!payment && order.carrier ? [['Carrier', order.carrier]] : []),
    ...(!payment && order.trackingCode ? [['Tracking / order reference', order.trackingCode]] : []),
  ];
  const trackingUrl = getTrackingUrl(clientUrl, order.trackingCode || orderId);
  const button = payment ? 'View Order' : 'Track Your Order';
  const notificationReason = 'You are receiving this order update because an order was placed with AceBeautyBraids using this email address.';
  const footer = `Questions about this order? Reply to this email${senderAddress ? ` to contact AceBeautyBraids at ${senderAddress}` : ''}.`;
  const text = [
    subject, `Hi ${name},`, intro,
    ...details.map(([label, value]) => `${label}: ${value}`),
    'Order summary:',
    ...items.map(item => `${item.name}${item.variant ? ` (${item.variant})` : ''} — ${item.qty} × ${item.price} = ${item.total}`),
    ...totals.map(([label, value]) => `${label}: ${value}`),
    ...(addressLines.length ? ['Delivery address:', ...addressLines] : []),
    ...(trackingUrl ? [`${button}: ${trackingUrl}`] : []),
    notificationReason, footer,
  ].join('\n\n');
  const cell = 'padding:10px 6px;border-bottom:1px solid #eeeeee;text-align:left;';
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${subject}</title></head>
<body style="margin:0;background:#f7f7f7;color:#1a1a1a;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#ffffff;border-top:5px solid #EC1E8C;"><tr><td style="padding:28px 20px;">
<p style="color:#EC1E8C;font-size:20px;font-weight:bold;">AceBeautyBraids</p>
<h1 style="font-size:24px;line-height:1.3;">${subject}</h1>
<p>Hi ${escapeHtml(name)},</p><p style="line-height:1.6;">${escapeHtml(intro)}</p>
${details.map(([label, value]) => `<p><strong>${label}:</strong> ${escapeHtml(value)}</p>`).join('')}
<h2 style="font-size:18px;">Order summary</h2>
<table width="100%" cellspacing="0" cellpadding="0" style="font-size:13px;border-collapse:collapse;overflow-wrap:anywhere;">
<thead><tr>${['Product / variant', 'Qty', 'Unit price', 'Total'].map(label => `<th scope="col" style="${cell}">${label}</th>`).join('')}</tr></thead>
<tbody>${items.map(item => `<tr><td style="${cell}">${escapeHtml(item.name)}${item.variant ? `<br><span style="color:#666666;">${escapeHtml(item.variant)}</span>` : ''}</td><td style="${cell}">${escapeHtml(item.qty)}</td><td style="${cell}">${escapeHtml(item.price)}</td><td style="${cell}">${escapeHtml(item.total)}</td></tr>`).join('')}</tbody></table>
${totals.map(([label, value]) => `<p><strong>${label}:</strong> ${escapeHtml(value)}</p>`).join('')}
${addressLines.length ? `<h2 style="font-size:18px;">Delivery address</h2><p style="line-height:1.6;">${addressLines.map(escapeHtml).join('<br>')}</p>` : ''}
${trackingUrl ? `<p style="margin:24px 0 8px;"><strong>${button}</strong></p><p style="margin:0 0 24px;overflow-wrap:anywhere;word-break:break-word;"><a href="${escapeHtml(trackingUrl)}" style="color:#b31565;text-decoration:underline;">${escapeHtml(trackingUrl)}</a></p>` : ''}
<p style="font-size:13px;color:#666666;line-height:1.6;">${notificationReason}</p>
<p style="font-size:13px;color:#666666;line-height:1.6;">${escapeHtml(footer)}</p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject, html, text };
};
