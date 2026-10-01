import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsNumber, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { MAX_MESSAGE_LENGTH } from '../security/injection-guard';

export class CreateRefundRequestDto {
  @IsString()
  @Matches(/^ORD-\d{4,8}$/, { message: 'orderId must look like ORD-1234' })
  orderId: string;

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Length(5, MAX_MESSAGE_LENGTH, { message: `message must be between 5 and ${MAX_MESSAGE_LENGTH} characters` })
  message: string;
}

export class ResolveRequestDto {
  @IsIn(['approve', 'deny'])
  action: 'approve' | 'deny';

  @IsString()
  @Length(3, 1000)
  note: string;

  /**
   * Whole items to refund when approving (e.g. to include a final-sale exception); the refund is their full
   * value. Defaults to the request's candidate items. There is no amount override: a partial payment must not
   * mark an item as fully refunded.
   */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @Matches(/^IT-\d{4,8}$/, { each: true, message: 'itemIds must look like IT-1001' })
  itemIds?: string[];
}

export class ListRequestsQuery {
  @IsOptional()
  @IsIn(['APPROVED', 'DENIED', 'ESCALATED'])
  decision?: 'APPROVED' | 'DENIED' | 'ESCALATED';

  @IsOptional()
  @IsIn(['closed', 'pending_review', 'resolved_approved', 'resolved_denied'])
  status?: 'closed' | 'pending_review' | 'resolved_approved' | 'resolved_denied';

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(1)
  @Max(200)
  limit?: number;

  /** Opaque keyset cursor from the previous page's `nextCursor`. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;
}

/** A customer's conversation, newest page first; `before` pages back through older requests. */
export class CustomerHistoryQuery {
  @IsOptional()
  @Matches(/^ORD-\d{4,8}$/, { message: 'orderId must look like ORD-1234' })
  orderId?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  before?: string;
}
