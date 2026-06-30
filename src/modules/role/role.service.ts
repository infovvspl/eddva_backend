import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '../../database/entities/role.entity';

@Injectable()
export class RoleService {
  constructor(
    @InjectRepository(Role, 'coaching')
    private readonly roleRepo: Repository<Role>,
  ) {}

  async create(dto: { name: string; description?: string; permissions: string[] }, tenantId: string) {
    const existing = await this.roleRepo.findOne({
      where: { name: dto.name, tenantId },
    });
    if (existing) {
      throw new ConflictException(`Role with name "${dto.name}" already exists in this institute`);
    }

    const role = this.roleRepo.create({
      ...dto,
      tenantId,
    });
    return this.roleRepo.save(role);
  }

  async findAll(tenantId: string) {
    return this.roleRepo.find({
      where: { tenantId },
      order: { createdAt: 'ASC' },
    });
  }

  async findOne(id: string, tenantId: string) {
    const role = await this.roleRepo.findOne({
      where: { id, tenantId },
    });
    if (!role) {
      throw new NotFoundException(`Role ${id} not found`);
    }
    return role;
  }

  async update(id: string, dto: { name?: string; description?: string; permissions?: string[] }, tenantId: string) {
    const role = await this.findOne(id, tenantId);

    if (dto.name && dto.name !== role.name) {
      const existing = await this.roleRepo.findOne({
        where: { name: dto.name, tenantId },
      });
      if (existing) {
        throw new ConflictException(`Role with name "${dto.name}" already exists`);
      }
    }

    Object.assign(role, dto);
    return this.roleRepo.save(role);
  }

  async remove(id: string, tenantId: string) {
    const role = await this.findOne(id, tenantId);
    await this.roleRepo.remove(role);
    return { success: true };
  }
}
