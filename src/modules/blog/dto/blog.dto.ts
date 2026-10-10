import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsIn,
  IsNumber,
  IsObject,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BlogPostStatus } from '../../../database/entities/blog-post.entity';

export class BlogReferenceDto {
  @IsString()
  @MaxLength(80)
  id: string;

  @IsIn(['footnote', 'endnote'])
  kind: 'footnote' | 'endnote';

  @IsString()
  @MaxLength(4000)
  text: string;
}

export class BlogDocumentSettingsDto {
  @IsOptional()
  @IsIn(['A4', 'LETTER'])
  pageSize?: 'A4' | 'LETTER';

  @IsOptional() @IsNumber() marginTop?: number;
  @IsOptional() @IsNumber() marginRight?: number;
  @IsOptional() @IsNumber() marginBottom?: number;
  @IsOptional() @IsNumber() marginLeft?: number;

  @IsOptional() @IsString() @MaxLength(500) header?: string;
  @IsOptional() @IsString() @MaxLength(500) footer?: string;
  @IsOptional() showPageNumbers?: boolean;
  @IsOptional() showTotalPages?: boolean;
  @IsOptional() @IsString() @MaxLength(80) fontFamily?: string;
  @IsOptional() @IsNumber() fontSize?: number;
}

export class BlogSectionDto {
  @IsString()
  @MaxLength(160)
  heading: string;

  @IsString()
  @MaxLength(20000)
  body: string;

  @IsOptional()
  @IsObject()
  contentJson?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BlogReferenceDto)
  references?: BlogReferenceDto[];
}

export class CreateBlogPostDto {
  @IsString()
  @MaxLength(200)
  title: string;

  // Derived from `title` when omitted — see BlogService.slugify.
  @IsOptional()
  @IsString()
  @MaxLength(220)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  excerpt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  author?: string;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  coverImage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  coverImageAlt?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readTime?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BlogSectionDto)
  sections?: BlogSectionDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => BlogDocumentSettingsDto)
  documentSettings?: BlogDocumentSettingsDto;

  @IsOptional()
  @IsEnum(BlogPostStatus)
  status?: BlogPostStatus;
}

export class UpdateBlogPostDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(220)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  excerpt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  author?: string;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  coverImage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  coverImageAlt?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readTime?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BlogSectionDto)
  sections?: BlogSectionDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => BlogDocumentSettingsDto)
  documentSettings?: BlogDocumentSettingsDto;

  @IsOptional()
  @IsEnum(BlogPostStatus)
  status?: BlogPostStatus;
}

export class ListBlogPostsQueryDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsEnum(BlogPostStatus)
  status?: BlogPostStatus;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 50;
}

export class PublicBlogQueryDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 50;
}
