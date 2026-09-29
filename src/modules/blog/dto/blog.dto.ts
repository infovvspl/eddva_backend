import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BlogPostStatus } from '../../../database/entities/blog-post.entity';

export class BlogSectionDto {
  @IsString()
  @MaxLength(160)
  heading: string;

  @IsString()
  @MaxLength(8000)
  body: string;
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
