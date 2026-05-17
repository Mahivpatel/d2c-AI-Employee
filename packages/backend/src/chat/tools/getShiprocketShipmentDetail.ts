import { tool } from 'ai';
import { z } from 'zod';
import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { resolveMerchantId } from './context';

export const getShiprocketShipmentDetail = tool({
  description: `Fetch one Shiprocket shipment by AWB, shipment_id, order_id, raw_id, or fact_id. Includes related tracking/NDR/RTO events when synced.`,
  inputSchema: z.object({
    merchant_id: z.string().optional(),
    awb_code: z.string().optional(),
    shipment_id: z.string().optional(),
    order_id: z.string().optional(),
    fact_id: z.string().optional(),
  }).refine(
    (value) => Boolean(value.awb_code || value.shipment_id || value.order_id || value.fact_id),
    'Provide at least one of awb_code, shipment_id, order_id, or fact_id',
  ),
  execute: async (args: any, options: any) => {
    const merchant_id = resolveMerchantId(args, options);
    const awb = args.awb_code ? String(args.awb_code).trim() : '__none__';
    const shipmentId = args.shipment_id ? String(args.shipment_id).trim() : '__none__';
    const orderId = args.order_id ? String(args.order_id).trim() : '__none__';
    const factId = args.fact_id ? String(args.fact_id).trim() : '__none__';

    const shipmentResult = await db.execute(sql`
      SELECT
        fact_id::text,
        source,
        raw_id,
        entity_type,
        occurred_at,
        amount_inr,
        dimensions,
        raw_payload
      FROM facts
      WHERE merchant_id = ${merchant_id}
        AND source = 'shiprocket'
        AND entity_type = 'shipment'
        AND (
          fact_id::text = ${factId}
          OR raw_id = ${factId}
          OR dimensions->>'awb_code' = ${awb}
          OR dimensions->>'shipment_id' = ${shipmentId}
          OR dimensions->>'order_id' = ${orderId}
        )
      LIMIT 1
    `);

    const shipment = shipmentResult.rows[0] as any;
    if (!shipment) {
      return {
        error: 'Shiprocket shipment not found',
        searched: { awb_code: awb, shipment_id: shipmentId, order_id: orderId, fact_id: factId },
        source: 'shiprocket',
      };
    }

    const relatedAwb = shipment.dimensions?.awb_code ?? awb;
    const relatedShipmentId = String(shipment.dimensions?.shipment_id ?? shipmentId);

    const eventsResult = await db.execute(sql`
      SELECT
        fact_id::text,
        entity_type,
        occurred_at,
        dimensions,
        raw_payload
      FROM facts
      WHERE merchant_id = ${merchant_id}
        AND source = 'shiprocket'
        AND entity_type IN ('tracking_event', 'ndr_event', 'rto_event')
        AND (
          dimensions->>'awb_code' = ${String(relatedAwb)}
          OR dimensions->>'shipment_id' = ${relatedShipmentId}
        )
      ORDER BY occurred_at ASC
    `);

    const events = eventsResult.rows as any[];

    return {
      shipment,
      events,
      fact_ids: [shipment.fact_id, ...events.map((event) => event.fact_id)],
      source: 'shiprocket',
    };
  },
});
