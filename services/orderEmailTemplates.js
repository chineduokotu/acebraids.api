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

export const renderAdminNewOrderEmail = (order, clientUrl, senderAddress = '') => {
  const orderId = String(order._id || '');
  const refCode = order.trackingCode || orderId.slice(-6);
  const subject = `New Order Received – Order #${refCode}`;
  const customerName = [order.guestInfo?.firstName, order.guestInfo?.lastName].filter(Boolean).join(' ') || order.user?.name || 'Customer';
  const customerEmail = order.guestInfo?.email || order.user?.email || 'N/A';
  const customerPhone = order.guestInfo?.phone || 'Not provided';
  const paymentMethod = order.paymentMethod === 'stripe' ? 'Stripe' : 'Manual / Bank Transfer';
  const paymentStatus = (order.paymentStatus || 'pending').replace(/_/g, ' ').toUpperCase();
  const dateFormatted = new Date(order.createdAt || Date.now()).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

  const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: order.currency || 'GBP' });
  const format = (amount) => money.format(Number(amount) || 0);

  const items = (order.items || []).map((item) => ({
    name: item.name || 'Product',
    variant: [item.variant?.color, item.variant?.length, item.variant?.capSize].filter(Boolean).join(' / ') || item.variant?.label || '',
    qty: item.qty || 1,
    price: format(item.price),
    total: format(Number(item.price || 0) * Number(item.qty || 1)),
  }));

  const totals = [
    ['Subtotal', format(order.subtotal)],
    ['Shipping', format(order.shippingFee)],
    ['Order Total', format(order.total)],
  ];

  const baseUrl = String(clientUrl || '').trim().replace(/\/+$/, '');
  const adminOrderUrl = baseUrl ? `${baseUrl}/admin/orders?order=${encodeURIComponent(orderId)}` : '';

  const details = [
    ['Order ID', `#${order.trackingCode || orderId}`],
    ['Customer Name', customerName],
    ['Customer Email', customerEmail],
    ['Customer Phone', customerPhone],
    ['Payment Method', paymentMethod],
    ['Payment Status', paymentStatus],
    ['Order Date/Time', dateFormatted],
    ['Total Amount', format(order.total)],
  ];

  const text = [
    subject,
    '========================================',
    'A new order has been placed. Please review the order and confirm the payment from the admin dashboard.',
    '',
    'NOTE: This notification is an order alert. Please verify that payment was received before fulfilling.',
    '',
    'ORDER DETAILS:',
    ...details.map(([label, value]) => `${label}: ${value}`),
    '',
    'ORDERED ITEMS:',
    ...items.map((item) => `- ${item.name}${item.variant ? ` (${item.variant})` : ''} x ${item.qty} (${item.price} each) = ${item.total}`),
    '',
    ...totals.map(([label, value]) => `${label}: ${value}`),
    '',
    ...(adminOrderUrl ? [`VIEW ORDER IN DASHBOARD:\n${adminOrderUrl}`] : []),
  ].join('\n');

  const cell = 'padding:10px 8px;border-bottom:1px solid #eeeeee;text-align:left;';
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;background:#f4f5f7;color:#1a1a1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
  <tr><td style="background:#111827;padding:20px 24px;border-bottom:3px solid #EC1E8C;">
    <table width="100%" cellspacing="0" cellpadding="0"><tr>
      <td><span style="color:#EC1E8C;font-size:18px;font-weight:bold;letter-spacing:0.5px;">AceBeautyBraids</span></td>
      <td align="right"><span style="background:#374151;color:#f3f4f6;font-size:11px;font-weight:bold;padding:4px 10px;border-radius:12px;text-transform:uppercase;letter-spacing:0.5px;">Admin Alert</span></td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:28px 24px;">
    <h1 style="font-size:22px;margin:0 0 12px;color:#111827;font-weight:800;">New Order Received</h1>
    <p style="font-size:15px;line-height:1.5;margin:0 0 16px;color:#374151;">
      A new order has been placed. Please review the order and confirm the payment from the admin dashboard.
    </p>

    <div style="background:#fffbeb;border-left:4px solid #f59e0b;padding:12px 16px;margin:0 0 24px;border-radius:4px;">
      <p style="margin:0;font-size:13px;line-height:1.5;color:#92400e;">
        <strong>Action Required:</strong> Please verify the payment in your bank account or Stripe dashboard, then update the order status in the admin dashboard.
      </p>
    </div>

    <h2 style="font-size:15px;font-weight:700;margin:20px 0 10px;color:#111827;text-transform:uppercase;letter-spacing:0.5px;">Order Information</h2>
    <table width="100%" cellspacing="0" cellpadding="0" style="font-size:13px;border-collapse:collapse;margin-bottom:20px;background:#f9fafb;border-radius:8px;overflow:hidden;border:1px solid #f3f4f6;">
      ${details.map(([label, value]) => `<tr><td style="padding:8px 12px;font-weight:600;color:#4b5563;width:40%;border-bottom:1px solid #e5e7eb;">${escapeHtml(label)}</td><td style="padding:8px 12px;color:#111827;font-weight:500;border-bottom:1px solid #e5e7eb;">${escapeHtml(value)}</td></tr>`).join('')}
    </table>

    <h2 style="font-size:15px;font-weight:700;margin:24px 0 10px;color:#111827;text-transform:uppercase;letter-spacing:0.5px;">Ordered Items</h2>
    <table width="100%" cellspacing="0" cellpadding="0" style="font-size:13px;border-collapse:collapse;margin-bottom:16px;">
      <thead><tr style="background:#f3f4f6;">
        <th style="${cell}font-weight:700;color:#374151;">Item / Options</th>
        <th style="${cell}font-weight:700;color:#374151;text-align:center;">Qty</th>
        <th style="${cell}font-weight:700;color:#374151;text-align:right;">Price</th>
        <th style="${cell}font-weight:700;color:#374151;text-align:right;">Total</th>
      </tr></thead>
      <tbody>
        ${items.map((item) => `<tr>
          <td style="${cell}">
            <strong style="color:#111827;">${escapeHtml(item.name)}</strong>
            ${item.variant ? `<br><span style="color:#6b7280;font-size:12px;">Option: ${escapeHtml(item.variant)}</span>` : ''}
          </td>
          <td style="${cell}text-align:center;">${escapeHtml(item.qty)}</td>
          <td style="${cell}text-align:right;">${escapeHtml(item.price)}</td>
          <td style="${cell}text-align:right;font-weight:600;">${escapeHtml(item.total)}</td>
        </tr>`).join('')}
      </tbody>
    </table>

    <table width="100%" cellspacing="0" cellpadding="0" style="font-size:13px;margin-bottom:24px;">
      ${totals.map(([label, value]) => `<tr>
        <td style="padding:4px 0;text-align:right;color:#4b5563;font-weight:${label.includes('Total') ? '700' : '400'};font-size:${label.includes('Total') ? '15px' : '13px'};">${escapeHtml(label)}:</td>
        <td style="padding:4px 0 4px 16px;text-align:right;color:#111827;font-weight:700;width:100px;font-size:${label.includes('Total') ? '15px' : '13px'};">${escapeHtml(value)}</td>
      </tr>`).join('')}
    </table>

    ${adminOrderUrl ? `
    <div style="text-align:center;margin:32px 0 16px;">
      <a href="${escapeHtml(adminOrderUrl)}" style="display:inline-block;background:#EC1E8C;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;padding:14px 36px;border-radius:8px;box-shadow:0 4px 12px rgba(236,30,140,0.3);text-transform:uppercase;letter-spacing:0.5px;">VIEW ORDER</a>
    </div>
    <p style="text-align:center;font-size:11px;color:#9ca3af;margin:0 0 24px;word-break:break-all;">
      Or direct link: <a href="${escapeHtml(adminOrderUrl)}" style="color:#EC1E8C;text-decoration:underline;">${escapeHtml(adminOrderUrl)}</a>
    </p>` : ''}

    <p style="font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:16px;margin:16px 0 0;text-align:center;">
      This is an automated admin notification from AceBeautyBraids.
    </p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  return { subject, html, text };
};

