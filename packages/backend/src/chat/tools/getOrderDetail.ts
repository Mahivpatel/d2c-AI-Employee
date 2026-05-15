import { tool } from 'ai';
import { z }    from 'zod';
import { db }   from '../../db';
import { sql } from 'drizzle-orm';
import { resolveMerchantId } from './context';

export const getOrderDetail = tool({
  description: `Fetch a single Shopify order by fact_id, Shopify raw ID, or visible order name like #1001.`,
  inputSchema: z.object({
    merchant_id: z.string().optional(),
    order_id: z.string().describe('The fact_id, raw_id, or Shopify order name such as #1001'),
  }),
  execute: async (args: any, options: any) => {
    const merchant_id = resolveMerchantId(args, options);
    const orderId = String(args.order_id).trim();
    const orderIdWithoutHash = orderId.replace(/^#/, '');
    const orderName = orderId.startsWith('#') ? orderId : `#${orderId}`;

    const { rows } = await db.execute(sql`
      SELECT
        fact_id,
        source,
        raw_id,
        entity_type,
        amount_inr,
        occurred_at,
        raw_payload
      FROM facts
      WHERE merchant_id = ${merchant_id}
        AND source = 'shopify'
        AND entity_type = 'order'
        AND (
          fact_id::text = ${orderId}
          OR raw_id = ${orderId}
          OR raw_id = ${orderIdWithoutHash}
          OR raw_payload->>'id' = ${orderId}
          OR raw_payload->>'id' = ${orderIdWithoutHash}
          OR raw_payload->>'name' = ${orderId}
          OR raw_payload->>'name' = ${orderName}
          OR dimensions->>'order_name' = ${orderId}
          OR dimensions->>'order_name' = ${orderName}
          OR replace(dimensions->>'order_name', '#', '') = ${orderIdWithoutHash}
          OR replace(raw_payload->>'name', '#', '') = ${orderIdWithoutHash}
        )
      LIMIT 1
    `);

    const order = rows[0] as any;
    if (!order) {
      return {
        error: 'Order not found',
        searched: {
          merchant_id,
          order_id: orderId,
          order_name: orderName,
        },
      };
    }

    return {
      order_detail: {
        ...order,
      },
      fact_ids: [order.fact_id],
      source: order.source,
    };
  },
});
