import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MemoryMatchLeaderboard } from './entities/memory-match-leaderboard.entity';

@Injectable()
export class MemoryMatchService {
  constructor(
    @InjectRepository(MemoryMatchLeaderboard, 'school')
    private readonly leaderboardRepo: Repository<MemoryMatchLeaderboard>,
  ) {}

  async getLeaderboard() {
    const records = await this.leaderboardRepo.find({
      relations: ['user'],
      order: { xp: 'DESC' },
      take: 50,
    });

    return records.map((record, index) => ({
      rank: index + 1,
      name: record.user?.name || 'Anonymous Student',
      score: record.xp,
      deckCategory: record.deckName,
      difficulty: 'medium', // Fallback since difficulty isn't in entity
      turnsCount: record.turns,
      mismatchesCount: record.misses,
      date: record.createdAt,
    }));
  }

  async saveScore(userId: string, xp: number, deckName: string, turns: number, misses: number) {
    const entry = this.leaderboardRepo.create({
      userId,
      xp,
      deckName,
      turns,
      misses,
    });
    return this.leaderboardRepo.save(entry);
  }
}
