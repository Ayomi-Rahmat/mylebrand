// The journey every preorder goes through, in order.
// scope "batch"  -> recorded once for the whole batch (everyone's items travel together)
// scope "order"  -> recorded per customer (the founder packs and delivers one order at a time)
const STAGES = [
  { key: 'confirmed', scope: 'batch', phase: 'China', title: 'Order confirmed',
    desc: 'Your order is in. Preorder is closed and we are getting everything ready to buy.',
    inLabel: 'Confirmed', outLabel: null },
  { key: 'sourcing', scope: 'batch', phase: 'China', title: 'Sourcing your items',
    desc: 'We are buying your items from our suppliers in China.',
    inLabel: 'Started', outLabel: 'Done' },
  { key: 'china_warehouse', scope: 'batch', phase: 'China', title: 'At the China warehouse',
    desc: 'Your items have reached our shipping warehouse in China.',
    inLabel: 'Arrived', outLabel: 'Left' },
  { key: 'packed', scope: 'batch', phase: 'China', title: 'Packed for shipping',
    desc: 'Everything has been checked, packed and is ready to be loaded.',
    inLabel: 'Packed', outLabel: 'Shipped' },
  { key: 'at_sea', scope: 'batch', phase: 'At sea', title: 'On the ship',
    desc: 'Your items are sailing to Nigeria. This is the longest stretch, so it is normal for it to feel quiet. This page updates the moment anything changes.',
    inLabel: 'Set sail', outLabel: 'Landed' },
  { key: 'lagos_warehouse', scope: 'batch', phase: 'Lagos', title: 'Arrived in Lagos',
    desc: 'The shipment has landed at our Lagos warehouse.',
    inLabel: 'Arrived', outLabel: 'Left' },
  { key: 'customs', scope: 'batch', phase: 'Lagos', title: 'Customs clearance',
    desc: 'Government inspection and clearance. We cannot rush this part, but we are on it.',
    inLabel: 'Entered', outLabel: 'Cleared' },
  { key: 'founder_collected', scope: 'order', phase: 'Delivery', title: 'Collected by the founder',
    desc: 'Customs is done and the founder has your items in hand.',
    inLabel: 'Collected', outLabel: null },
  { key: 'packing', scope: 'order', phase: 'Delivery', title: 'Being packed',
    desc: 'The founder is packing your order personally.',
    inLabel: 'Started', outLabel: 'Done' },
  { key: 'packaged', scope: 'order', phase: 'Delivery', title: 'Packaged and ready',
    desc: 'Your order is packaged and waiting for its delivery slot.',
    inLabel: 'Packaged', outLabel: null },
  { key: 'delivery', scope: 'order', phase: 'Delivery', title: 'Out for delivery',
    desc: 'On its way to you. Keep your phone close.',
    inLabel: 'Dispatched', outLabel: 'Delivered' },
  { key: 'delivered', scope: 'order', phase: 'Delivery', title: 'Delivered',
    desc: 'Delivered. Enjoy your pieces.',
    inLabel: 'Delivered', outLabel: null },
];

const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s.key, i]));

module.exports = { STAGES, STAGE_INDEX };
